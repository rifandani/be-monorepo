import { Context, Effect, Layer, Metric } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { Api } from "#api/api.ts";
import type { PROBES } from "#api/health.ts";
import { Check, HealthReport, Unhealthy } from "#domain/health.ts";

/**
 * One dependency the readiness probe verifies.
 *
 * `verify` failing is the check failing. Why it failed never reaches the client
 * — see `domain/health.ts` — so the error type is only what the log line
 * renders, and `catchCause` below takes a defect just the same.
 */
export interface ReadinessCheck {
  readonly name: string;
  readonly verify: Effect.Effect<void, Error>;
}

/**
 * The checks this app's readiness probe runs.
 *
 * Empty, because this app depends on nothing: it has no database, no cache and
 * no upstream service. That is a fact about today's app and not a gap — add the
 * database's check here the day there is a database, and the readiness probe
 * starts answering 503 while it is down with no other change.
 */
export const READINESS_CHECKS: readonly ReadinessCheck[] = [];

// Built once. The startup and liveness probes have no checks by definition, so
// their report never varies.
const NO_CHECKS = HealthReport.make({ checks: [], status: "ok" });

/**
 * Which probe answered, and how.
 *
 * Neither field is written out. `probe` is `keyof typeof PROBES`, so a fourth
 * entry in `api/health.ts` widens what `recordProbe` accepts and the
 * `handleAll` map below stops compiling until the handler is there — which is
 * the whole of what makes a probe one declaration. `outcome` is the report's
 * own `status`, because a Probe Outcome says how the probe answered and the
 * answer is a Health Report; a union restated here could drift from the one
 * the client is given.
 */
interface ProbeOptions {
  readonly probe: keyof typeof PROBES;
  readonly outcome: HealthReport["status"];
}

/**
 * How many times each health probe was called, and how it answered.
 *
 * This is what the probes get *instead* of a span and a log line each. A
 * deployment polls them about once a second apiece, so tracing and logging them
 * would be a quarter of a million near-identical events a day; a counter is the
 * instrument shaped for exactly that. See `server/probes.ts`, which does the
 * excluding.
 */
export const probeResult = Metric.counter("health.probe.result", {
  description: "Health probe calls, by probe and outcome",
});

/**
 * The attributes one probe's series is keyed by.
 *
 * Exported, and the only place these two keys are written, because a metric's
 * series is keyed by `JSON.stringify(Object.entries(attributes))` — so
 * `{ probe, outcome }` and `{ outcome, probe }` are two different time series
 * holding half the traffic each. One helper is what makes the insertion order
 * a single fact rather than a convention every call site has to remember.
 */
export const probeAttributes = (options: ProbeOptions) => ({
  probe: options.probe,
  outcome: options.outcome,
});

/** Records that one probe answered, and how. */
const recordProbe = (options: ProbeOptions): Effect.Effect<void> =>
  Metric.update(
    Metric.withAttributes(probeResult, probeAttributes(options)),
    1
  );

/**
 * Runs one check and reports what happened, never failing.
 *
 * `catchCause` and not `catch`: a check that throws has died rather than failed,
 * and a readiness probe that cannot answer because one dependency's client
 * threw is worse than one that answers "not ready". The cause goes to the log,
 * where the detail is the operator's business.
 */
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

/**
 * What the app claims about its own health, apart from how it is asked.
 *
 * The three probes mean three different things to whoever polls them, and
 * `CONTEXT.md` is where that vocabulary lives. `handlers` only calls and
 * encodes.
 */
export class Health extends Context.Service<
  Health,
  {
    readonly startup: () => Effect.Effect<HealthReport>;
    readonly live: () => Effect.Effect<HealthReport>;
    readonly ready: () => Effect.Effect<HealthReport, Unhealthy>;
  }
>()("@workspace/effect/Health") {
  /**
   * What the three probes answer, apart from how they are reached.
   *
   * Takes its checks by parameter rather than reading `READINESS_CHECKS`, which is
   * the seam a test drives: a readiness probe with nothing to check can only ever
   * answer "ok", so the failing path would otherwise be unreachable and untested
   * until the day it mattered.
   */
  static readonly make = (
    checks: readonly ReadinessCheck[]
  ): Health["Service"] =>
    Health.of({
      /**
       * The startup probe.
       *
       * Answering at all is the signal. This layer built, which means the
       * configuration resolved and every dependency the app acquires was
       * acquired; a process still working through that has not reached the point
       * of serving this route. There is deliberately no flag being flipped
       * somewhere — a flag would be a second, less trustworthy account of the
       * same fact.
       */
      startup: Effect.fn("Health.startup")(function* startup() {
        yield* recordProbe({ outcome: "ok", probe: "startup" });

        return NO_CHECKS;
      }),

      /**
       * The liveness probe.
       *
       * Unconditional, and that is the correct implementation rather than a stub.
       * A liveness failure means "restart me", so anything checked here is
       * something a restart is being promised to fix — a dependency being down is
       * not, which is what the readiness probe is for. A wedged event loop cannot
       * answer this route at all, which is the failure the probe actually detects.
       */
      live: Effect.fn("Health.live")(function* live() {
        yield* recordProbe({ outcome: "ok", probe: "live" });

        return NO_CHECKS;
      }),

      /**
       * The readiness probe.
       *
       * Every check runs, concurrently, and every one of them reports — so the
       * report names all the failures, not just the first. A probe consumer reads
       * the status code, but the operator reading the body wants the whole list.
       */
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

  /**
   * `Layer.sync` and not `Layer.effect`, because there is nothing to acquire:
   * the checks are declarations, and each one acquires whatever it needs when
   * it runs. A check that needed a pooled client would make this
   * `Layer.effect`.
   */
  static readonly layer: Layer.Layer<Health> = Layer.sync(Health, () =>
    Health.make(READINESS_CHECKS)
  );

  /**
   * The handlers with their dependencies still open, so a test can supply a
   * `Health` whose readiness checks fail — which this app, depending on nothing,
   * cannot otherwise produce. `http.ts` provides `layer` at the call site.
   */
  static readonly handlers = HttpApiBuilder.group(
    Api,
    "health",
    Effect.fn(function* makeHealthHandlers(handlers) {
      const health = yield* Health;

      return handlers.handleAll({
        startup: () => health.startup(),
        live: () => health.live(),
        ready: () => health.ready(),
      });
    })
  );
}
