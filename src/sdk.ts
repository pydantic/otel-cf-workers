import { propagation } from '@opentelemetry/api'
import { Resource, resourceFromAttributes } from '@opentelemetry/resources'

import { Initialiser, parseConfig } from './config.js'
import { WorkerTracerProvider } from './provider.js'
import { Trigger, TraceConfig, ResolvedTraceConfig } from './types.js'
import { unwrap } from './wrap.js'
import { createFetchHandler, instrumentGlobalFetch } from './instrumentation/fetch.js'
import { instrumentGlobalCache } from './instrumentation/cache.js'
import { createQueueHandler } from './instrumentation/queue.js'
import { DOClass, instrumentDOClass } from './instrumentation/do.js'
import { createScheduledHandler } from './instrumentation/scheduled.js'
//@ts-ignore
import * as versions from '../versions.json'
import { createEmailHandler } from './instrumentation/email.js'
import {
	ATTR_TELEMETRY_SDK_LANGUAGE,
	ATTR_TELEMETRY_SDK_NAME,
	ATTR_TELEMETRY_SDK_VERSION,
} from '@opentelemetry/semantic-conventions'
import {
	ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
	ATTR_FAAS_MAX_MEMORY,
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_NAMESPACE,
	ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions/incubating'

type FetchHandler = ExportedHandlerFetchHandler<unknown, unknown>
type ScheduledHandler = ExportedHandlerScheduledHandler<unknown>
type QueueHandler = ExportedHandlerQueueHandler
type EmailHandler = EmailExportedHandler

export type ResolveConfigFn<Env = any> = (env: Env, trigger: Trigger) => TraceConfig
export type ConfigurationOption = TraceConfig | ResolveConfigFn

export function isRequest(trigger: Trigger): trigger is Request {
	return trigger instanceof Request
}

export function isMessageBatch(trigger: Trigger): trigger is MessageBatch {
	return !!(trigger as MessageBatch).ackAll
}

export function isAlarm(trigger: Trigger): trigger is 'do-alarm' {
	return trigger === 'do-alarm'
}

const createResource = (config: ResolvedTraceConfig): Resource => {
	const packageName = Object.keys(versions).find((name) => name.endsWith('otel-cf-workers')) as
		| keyof typeof versions
		| undefined

	if (!packageName) {
		throw new Error('Package name not found in versions.json, searched for otel-cf-workers$')
	}
	const workerResourceAttrs = {
		'cloud.provider': 'cloudflare',
		'cloud.platform': 'cloudflare.workers',
		'cloud.region': 'earth',
		[ATTR_FAAS_MAX_MEMORY]: 134217728,
		[ATTR_TELEMETRY_SDK_LANGUAGE]: 'js',
		[ATTR_TELEMETRY_SDK_NAME]: packageName,
		[ATTR_TELEMETRY_SDK_VERSION]: versions[packageName],
		'telemetry.sdk.build.node_version': versions['node'],
	}
	const serviceResource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: config.service.name,
		[ATTR_SERVICE_NAMESPACE]: config.service.namespace,
		[ATTR_SERVICE_VERSION]: config.service.version,
		...(config.environment ? { [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment } : {}),
	})
	const resource = resourceFromAttributes(workerResourceAttrs)
	return resource.merge(serviceResource)
}

let initialised = false
function init(config: ResolvedTraceConfig): void {
	if (!initialised) {
		if (config.instrumentation.instrumentGlobalCache) {
			instrumentGlobalCache()
		}
		if (config.instrumentation.instrumentGlobalFetch) {
			instrumentGlobalFetch()
		}
		propagation.setGlobalPropagator(config.propagator)
		const resource = createResource(config)

		const provider = new WorkerTracerProvider(config.spanProcessors, resource, config.scope, config.idGenerator)
		provider.register()
		initialised = true
	}
}

function createInitialiser(config: ConfigurationOption): Initialiser {
	if (typeof config === 'function') {
		return (env, trigger) => {
			const conf = parseConfig(config(env, trigger))
			init(conf)
			return conf
		}
	} else {
		return () => {
			const conf = parseConfig(config)
			init(conf)
			return conf
		}
	}
}

export function instrument<E, Q, C>(
	handler: ExportedHandler<E, Q, C>,
	config: ConfigurationOption,
): ExportedHandler<E, Q, C> {
	const initialiser = createInitialiser(config)

	if (handler.fetch) {
		const fetcher = unwrap(handler.fetch) as FetchHandler
		handler.fetch = createFetchHandler(fetcher, initialiser)
	}

	if (handler.scheduled) {
		const scheduler = unwrap(handler.scheduled) as ScheduledHandler
		handler.scheduled = createScheduledHandler(scheduler, initialiser)
	}

	if (handler.queue) {
		const queuer = unwrap(handler.queue) as QueueHandler
		handler.queue = createQueueHandler(queuer, initialiser)
	}

	if (handler.email) {
		const emailer = unwrap(handler.email) as EmailHandler
		handler.email = createEmailHandler(emailer, initialiser)
	}

	return handler
}

export function instrumentDO(doClass: DOClass, config: ConfigurationOption) {
	const initialiser = createInitialiser(config)

	return instrumentDOClass(doClass, initialiser)
}

export { waitUntilTrace } from './instrumentation/fetch.js'

export const __unwrappedFetch = unwrap(fetch)
