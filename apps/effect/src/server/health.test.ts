import { assert, describe, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import { Unhealthy } from "#domain/health.ts";

import { Health, READINESS_CHECKS } from "./health.ts";
import { probeAttributes, probeResult } from "./metrics.ts";

// The endpoints are covered in `tests/health.test.ts` and their mount points in
// `tests/app.test.ts`. What is left is what the three probes claim — and, for
// readiness, the failing path this app has no dependency to reach on its own.
// `Health.make` taking its checks by parameter is that seam.
//
// A fresh registry per run, for the reason `metrics.test.ts` explains: the
// default one is shared by every test in the process.
const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    Effect.provideService(effect, Metric.MetricRegistry, new Map())
  );

const passing = (name: string) => ({ name, verify: Effect.void });

const failing = (name: string) => ({
  name,
  verify: Effect.fail(new Error(`${name} is down`)),
});

describe("startup probe", () => {
  it("reports ok with no checks", async () => {
    const report = await run(Health.make([]).startup());

    assert.deepStrictEqual(report, { checks: [], status: "ok" });
  });

  // It answers for the process, so a readiness dependency being down is none of
  // its business: reporting otherwise would suspend the liveness clock on a
  // process that had in fact finished booting.
  it("reports ok even when a readiness check would fail", async () => {
    const report = await run(Health.make([failing("db")]).startup());

    assert.deepStrictEqual(report, { checks: [], status: "ok" });
  });
});

describe("liveness probe", () => {
  it("reports ok with no checks", async () => {
    const report = await run(Health.make([]).live());

    assert.deepStrictEqual(report, { checks: [], status: "ok" });
  });

  // A liveness failure means "restart me". A dependency being down is not
  // something a restart fixes, so it must not reach this probe.
  it("reports ok even when a readiness check would fail", async () => {
    const report = await run(Health.make([failing("db")]).live());

    assert.deepStrictEqual(report, { checks: [], status: "ok" });
  });
});

describe("readiness probe", () => {
  it("reports ok when there is nothing to check", async () => {
    const report = await run(Health.make([]).ready());

    assert.deepStrictEqual(report, { checks: [], status: "ok" });
  });

  it("lists a check that passed", async () => {
    const report = await run(Health.make([passing("db")]).ready());

    assert.deepStrictEqual(report, {
      checks: [{ name: "db", status: "pass" }],
      status: "ok",
    });
  });

  it("fails with Unhealthy when a check fails", async () => {
    const error = await run(Effect.flip(Health.make([failing("db")]).ready()));

    assert.isTrue(error instanceof Unhealthy);
    assert.strictEqual(error.status, "unhealthy");
    assert.deepStrictEqual(error.checks, [{ name: "db", status: "fail" }]);
  });

  // The report names every failure, not the first one, because the operator
  // reading the body is trying to work out what is down.
  it("reports every check, passed and failed", async () => {
    const error = await run(
      Effect.flip(
        Health.make([passing("db"), failing("cache"), failing("queue")]).ready()
      )
    );

    assert.deepStrictEqual(error.checks, [
      { name: "db", status: "pass" },
      { name: "cache", status: "fail" },
      { name: "queue", status: "fail" },
    ]);
  });

  // A check that throws has died rather than failed. A probe that cannot answer
  // because one dependency's client threw is worse than one answering 503.
  it("treats a check that dies as a check that failed", async () => {
    const error = await run(
      Effect.flip(
        Health.make([
          {
            name: "db",
            verify: Effect.die(new Error("client blew up")),
          },
        ]).ready()
      )
    );

    assert.deepStrictEqual(error.checks, [{ name: "db", status: "fail" }]);
  });
});

// The probes are counted instead of being traced and logged, so the counter is
// the only account of them there is. See `probes.ts`.
describe("probe metric", () => {
  it("counts a readiness success and a readiness failure apart", async () => {
    const [ok, unhealthy] = await run(
      Effect.gen(function* probe() {
        yield* Health.make([]).ready();
        yield* Effect.ignore(Health.make([failing("db")]).ready());

        return [
          yield* Metric.value(
            Metric.withAttributes(
              probeResult,
              probeAttributes({ outcome: "ok", probe: "ready" })
            )
          ),
          yield* Metric.value(
            Metric.withAttributes(
              probeResult,
              probeAttributes({ outcome: "unhealthy", probe: "ready" })
            )
          ),
        ] as const;
      })
    );

    assert.strictEqual(ok.count, 1);
    assert.strictEqual(unhealthy.count, 1);
  });

  it("counts the startup and liveness probes under their own names", async () => {
    const [startup, live] = await run(
      Effect.gen(function* probe() {
        yield* Health.make([]).startup();
        yield* Health.make([]).live();

        return [
          yield* Metric.value(
            Metric.withAttributes(
              probeResult,
              probeAttributes({ outcome: "ok", probe: "startup" })
            )
          ),
          yield* Metric.value(
            Metric.withAttributes(
              probeResult,
              probeAttributes({ outcome: "ok", probe: "live" })
            )
          ),
        ] as const;
      })
    );

    assert.strictEqual(startup.count, 1);
    assert.strictEqual(live.count, 1);
  });
});

// This app depends on nothing, so its readiness probe has nothing to check.
// The assertion is here to make that a stated property rather than an
// assumption the tests above quietly rely on.
describe("this app's checks", () => {
  it("has none", () => {
    assert.deepStrictEqual(READINESS_CHECKS, []);
  });
});
