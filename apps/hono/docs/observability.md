# Observability

- Request handlers: `c.get('log').set()` / `.error()` (evlog middleware)
- Outside request scope: `log` from `evlog` (startup, shutdown, stores)
- Errors: `throw createError({ message, status, why, fix })`; handle with `parseError()` in `app.onError`
- Traces: `@hono/otel` + OTEL SDK in `instrumentation.ts`
