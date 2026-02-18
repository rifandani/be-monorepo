# Observability

Instrument in server ONLY by using `@/core/utils/logger`.
Console log using logger from `@workspace/core/utils/logger`.
Use `span.setAttributes` and `span.addEvent` most of the time, use `logger` only in places where you don't care about measuring the timing (e.g. global app error handler), or when you want to emphasize and save some important information / state changes.
