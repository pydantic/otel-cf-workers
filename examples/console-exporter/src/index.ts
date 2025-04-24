import { trace } from '@opentelemetry/api';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { instrument, ResolveConfigFn } from '@pydantic/otel-cf-workers';

export interface Env {
	OTEL_TEST: KVNamespace;
}

const handler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		await fetch('https://cloudflare.com');

		const greeting = "G'day World";
		trace.getActiveSpan()?.setAttribute('greeting', greeting);
		ctx.waitUntil(fetch('https://workers.dev'));
		return new Response(`${greeting}!`);
	},
};

const config: ResolveConfigFn = (env: Env, _trigger) => {
	return {
		exporter: new ConsoleSpanExporter(),
		service: { name: 'greetings' },
		scope: { name: 'my-cf-worker', version: '1.0.0' },
	};
};

export default instrument(handler, config);
