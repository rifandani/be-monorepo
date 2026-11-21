import { Config } from "effect";

export const APP_TITLE = Config.NonEmptyString("APP_TITLE");

export const APP_URL = Config.URL("PORTLESS_URL").pipe(
  Config.orElse(() => Config.URL("APP_URL"))
);

export const PORT = Config.Port("PORT").pipe(Config.withDefault(3000));

export const OTEL_EXPORTER_OTLP_ENDPOINT = Config.URL(
  "OTEL_EXPORTER_OTLP_ENDPOINT"
);

export const OTEL_LOG_LEVEL = Config.Literals(
  ["ALL", "VERBOSE", "DEBUG", "INFO", "WARN", "ERROR", "NONE"],
  "OTEL_LOG_LEVEL"
);
