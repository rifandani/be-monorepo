import { assert, describe, it } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit } from "effect";

import {
  MAX_IN_FLIGHT_PROBES,
  MAX_IN_FLIGHT_REQUESTS,
  OTEL_EXPORTER_OTLP_ENDPOINT,
  OTEL_LOG_LEVEL,
  readAll,
} from "./config.ts";

const withEnv =
  (env: Record<string, string>) =>
  <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.provide(
      effect,
      ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))
    );

const failureMessages = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? exit.cause.reasons
        .filter(Cause.isFailReason)
        .map(({ error }) => String(error))
    : [];

describe(readAll, () => {
  it.effect("reports both wrong variables in one run", () =>
    Effect.gen(function* twoWrong() {
      const exit = yield* Effect.exit(
        readAll({ OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_LOG_LEVEL }).pipe(
          withEnv({
            OTEL_EXPORTER_OTLP_ENDPOINT: "not a url",
            OTEL_LOG_LEVEL: "LOUD",
          })
        )
      );

      const messages = failureMessages(exit);

      assert.lengthOf(messages, 2);
      assert.isTrue(
        messages.some((message) =>
          message.includes("OTEL_EXPORTER_OTLP_ENDPOINT")
        )
      );
      assert.isTrue(
        messages.some((message) => message.includes("OTEL_LOG_LEVEL"))
      );
    })
  );

  it.effect("reports both wrong capacities in one run", () =>
    Effect.gen(function* twoCapacities() {
      const exit = yield* Effect.exit(
        readAll({ MAX_IN_FLIGHT_PROBES, MAX_IN_FLIGHT_REQUESTS }).pipe(
          withEnv({ MAX_IN_FLIGHT_PROBES: "0", MAX_IN_FLIGHT_REQUESTS: "-1" })
        )
      );

      assert.lengthOf(failureMessages(exit), 2);
    })
  );

  it.effect("reads every value when all are valid", () =>
    Effect.gen(function* allValid() {
      const values = yield* readAll({
        MAX_IN_FLIGHT_PROBES,
        MAX_IN_FLIGHT_REQUESTS,
        OTEL_LOG_LEVEL,
      }).pipe(withEnv({ MAX_IN_FLIGHT_PROBES: "4", OTEL_LOG_LEVEL: "WARN" }));

      assert.deepStrictEqual(values, {
        MAX_IN_FLIGHT_PROBES: 4,
        MAX_IN_FLIGHT_REQUESTS: 256,
        OTEL_LOG_LEVEL: "WARN",
      });
    })
  );
});
