import { Context, Effect, Layer, Metric } from "effect";

import type { PROBES } from "./api.ts";
import { Check, HealthReport, Unhealthy } from "./schema.ts";

export interface ReadinessCheck {
  readonly name: string;
  readonly verify: Effect.Effect<void, Error>;
}

export const READINESS_CHECKS: readonly ReadinessCheck[] = [];

const NO_CHECKS = HealthReport.make({ checks: [], status: "ok" });

interface ProbeOptions {
  readonly probe: keyof typeof PROBES;
  readonly outcome: HealthReport["status"];
}

export const probeResult = Metric.counter("health.probe.result", {
  description: "Health probe calls, by probe and outcome",
});

export const probeAttributes = (options: ProbeOptions) => ({
  probe: options.probe,
  outcome: options.outcome,
});

const recordProbe = (options: ProbeOptions): Effect.Effect<void> =>
  Metric.update(
    Metric.withAttributes(probeResult, probeAttributes(options)),
    1
  );

const runCheck = Effect.fn("Health.runCheck")(function* check(
  readinessCheck: ReadinessCheck
) {
  return yield* readinessCheck.verify.pipe(
    Effect.as(Check.make({ name: readinessCheck.name, status: "pass" })),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logError(`Readiness check ${readinessCheck.name} failed`, cause),
        Check.make({ name: readinessCheck.name, status: "fail" })
      )
    )
  );
});

export class Health extends Context.Service<
  Health,
  {
    readonly startup: () => Effect.Effect<HealthReport>;
    readonly live: () => Effect.Effect<HealthReport>;
    readonly ready: () => Effect.Effect<HealthReport, Unhealthy>;
  }
>()("@workspace/effect/Health") {
  static readonly make = (
    checks: readonly ReadinessCheck[]
  ): Health["Service"] =>
    Health.of({
      startup: Effect.fn("Health.startup")(function* startup() {
        yield* recordProbe({ outcome: "ok", probe: "startup" });

        return NO_CHECKS;
      }),

      live: Effect.fn("Health.live")(function* live() {
        yield* recordProbe({ outcome: "ok", probe: "live" });

        return NO_CHECKS;
      }),

      ready: Effect.fn("Health.ready")(function* ready() {
        const results = yield* Effect.forEach(checks, runCheck, {
          concurrency: "unbounded",
        });

        const passed = results.every((check) => check.status === "pass");

        yield* recordProbe({
          outcome: passed ? "ok" : "unhealthy",
          probe: "ready",
        });

        if (passed) {
          return HealthReport.make({ checks: results, status: "ok" });
        }

        return yield* new Unhealthy({ checks: results, status: "unhealthy" });
      }),
    });

  static readonly layer: Layer.Layer<Health> = Layer.sync(Health, () =>
    Health.make(READINESS_CHECKS)
  );
}
