# Platform services — narrative

Verified controls and parameters: [platform-services.html](platform-services.html).

## Security posture

The API's defaults are explicit rather than incidental: password hashing is scrypt with stated parameters; JWT lifetimes are short (1 h production) and startup refuses a weak signing secret; failed logins lock accounts; every mutating route passes tenant-isolation ownership checks with a closed table set; security headers and CSP ship on by default; outbound requests flow through an SSRF guard with an allowlist. These are ordinary controls for an ordinary deployment — documented as implemented, nothing more claimed.

## Execution boundaries

Where the platform runs code (agent tools, user sandboxes, simulation kernels), the boundaries are numeric and visible: sandbox concurrency caps, 1–120 s execution timeouts, payload-size validation, audit records per execution. The simulation kernels receive data only through a serialized JSON parameter file — the documented reason the wire contract in `kaggleSim.ts` is the security-relevant boundary for simulations: anything malformed fails before it becomes Python.

## Operations surface

Observability is standard: structured logs with correlation IDs, Prometheus metrics, opt-in Sentry and OpenTelemetry init, health/readiness endpoints whose components were observed in a real boot. Job queueing, plugin lifecycle, monitor/scheduler engines and a GGUF model manager round out the service layer. None of this is exotic, which is the point: a scientific platform earns trust by being boring where it can be.
