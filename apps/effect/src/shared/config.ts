import { Config, Schema } from "effect";

export const APP_TITLE = Config.NonEmptyString("APP_TITLE");

export const APP_URL = Config.URL("PORTLESS_URL").pipe(
  Config.orElse(() => Config.URL("APP_URL"))
);

export const PORT = Config.Port("PORT").pipe(Config.withDefault(3000));

const DEFAULT_MAX_IN_FLIGHT_REQUESTS = 256;
const DEFAULT_MAX_IN_FLIGHT_PROBES = 8;

const Capacity = Schema.Int.check(Schema.isGreaterThan(0));

export const MAX_IN_FLIGHT_REQUESTS = Config.schema(
  Capacity,
  "MAX_IN_FLIGHT_REQUESTS"
).pipe(Config.withDefault(DEFAULT_MAX_IN_FLIGHT_REQUESTS));

export const MAX_IN_FLIGHT_PROBES = Config.schema(
  Capacity,
  "MAX_IN_FLIGHT_PROBES"
).pipe(Config.withDefault(DEFAULT_MAX_IN_FLIGHT_PROBES));

export const OTEL_EXPORTER_OTLP_ENDPOINT = Config.URL(
  "OTEL_EXPORTER_OTLP_ENDPOINT"
);

export const OTEL_LOG_LEVEL = Config.Literals(
  ["ALL", "VERBOSE", "DEBUG", "INFO", "WARN", "ERROR", "NONE"],
  "OTEL_LOG_LEVEL"
);
