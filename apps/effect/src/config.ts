import { Config } from "effect";

/**
 * Environment, as `Config` rather than a schema validated at module load.
 *
 * A `Config<T>` is an `Effect<T, ConfigError>`, so nothing is read until the
 * layer that needs it is built. A missing or malformed variable therefore fails
 * the server's startup with a typed error instead of throwing during an import,
 * which is what keeps the tests free of any environment at all.
 */
export const APP_TITLE = Config.nonEmptyString("APP_TITLE");

/**
 * `portless` injects `PORTLESS_URL` (including the subdomain prefix it gives a
 * worktree), which is more accurate than anything the env file can state, so it
 * wins when present.
 */
export const APP_URL = Config.url("PORTLESS_URL").pipe(
  Config.orElse(() => Config.url("APP_URL"))
);

/**
 * Also injected by the portless proxy.
 *
 * The default is what makes `dev:server` and `node:dev:server` runnable on
 * their own. Those scripts exist to be called by `portless run`, which sets
 * `PORT`, but they are ordinary scripts and a developer will run one directly.
 * Without a default that is a startup `ConfigError`, not a server.
 */
export const PORT = Config.port("PORT").pipe(Config.withDefault(3000));

/**
 * Where the OTLP exporters send traces, metrics and log records.
 *
 * A `Config` and not left to the SDK's own lookup, which is the one thing worth
 * explaining here. The `@opentelemetry/exporter-*-otlp-http` packages read
 * `OTEL_EXPORTER_OTLP_ENDPOINT` from `process.env` themselves, so declaring
 * nothing would work — and a missing or misspelled value would be silent, with
 * spans dropped and no error anywhere. Read as a `Config` it is a `ConfigError`
 * that fails startup, which is the property the note at the top of this file is
 * about. `apps/hono` treats the same variable as required in its env schema.
 *
 * Only the endpoint is declared. Everything else about the SDK is left to its
 * own environment handling, and the service name and version come from
 * `metadata.ts` — that is, from `package.json` — rather than being restated as
 * environment.
 */
export const OTEL_EXPORTER_OTLP_ENDPOINT = Config.url(
  "OTEL_EXPORTER_OTLP_ENDPOINT"
);

/**
 * How loud the OpenTelemetry SDK is about its own problems.
 *
 * These are the SDK's diagnostics — an exporter that cannot reach the
 * collector, a dropped batch — and not the application's `Effect.log*` records,
 * which the log processor in `observability.ts` exports whatever this says.
 *
 * The names are `DiagLogLevel`'s own, so the value is the same one
 * `apps/hono` validates in `src/core/constants/env.ts` and every other
 * OpenTelemetry SDK reads. Declared as a `Config` for the reason
 * `OTEL_EXPORTER_OTLP_ENDPOINT` above is: `@effect/opentelemetry` builds the
 * providers itself and never runs `@opentelemetry/sdk-node`, which is the piece
 * that would otherwise read this variable, so `observability.ts` registers the
 * diag logger by hand and a misspelled level fails startup rather than being
 * ignored.
 */
export const OTEL_LOG_LEVEL = Config.literals(
  ["ALL", "VERBOSE", "DEBUG", "INFO", "WARN", "ERROR", "NONE"],
  "OTEL_LOG_LEVEL"
);
