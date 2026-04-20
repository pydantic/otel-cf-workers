---
'@pydantic/otel-cf-workers': minor
---

Upgrade OpenTelemetry dependencies to current releases, move unstable semconv usage behind a local compatibility layer, and migrate emitted database telemetry from `db.system` to `db.system.name` while retaining `rpc.message.id`.
