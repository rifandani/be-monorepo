import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect } from "effect";

import {
  endTime,
  formatMetric,
  ServerTiming,
  setMetric,
  startTime,
  timed,
} from "./timing.js";

// The middleware is covered through the composed app in `tests/app.test.ts`.
// What is left is the format, and the recording helpers a handler calls — which
// need a `ServerTiming` to record into but no request to reach it.
const makeServerTiming = (): ServerTiming => ({
  entries: [],
  timers: new Map(),
});

const run = (timings: ServerTiming, effect: Effect.Effect<void>) => {
  Effect.runSync(effect.pipe(Effect.provideService(ServerTiming, timings)));

  return timings.entries;
};

describe(formatMetric, () => {
  it("states a bare marker as its name", () => {
    assert.strictEqual(formatMetric({ name: "cache" }), "cache");
  });

  it("quotes a description", () => {
    assert.strictEqual(
      formatMetric({ description: "europe-west3", name: "region" }),
      'region;desc="europe-west3"'
    );
  });

  it("prints a duration to one digit by default", () => {
    assert.strictEqual(
      formatMetric({ duration: 23.85, name: "db" }),
      "db;dur=23.9"
    );
  });

  it("prints a duration to the precision asked for", () => {
    assert.strictEqual(
      formatMetric({ duration: 23.85, name: "db", precision: 3 }),
      "db;dur=23.850"
    );
  });

  it("carries both a duration and a description", () => {
    assert.strictEqual(
      formatMetric({
        description: "My custom Metric",
        duration: 1,
        name: "custom",
      }),
      'custom;dur=1.0;desc="My custom Metric"'
    );
  });
});

describe("recording", () => {
  it("records a marker and a duration", () => {
    const timings = makeServerTiming();

    assert.deepStrictEqual(
      run(
        timings,
        Effect.andThen(
          setMetric({ description: "europe-west3", name: "region" }),
          setMetric({ duration: Duration.millis(24), name: "custom" })
        )
      ),
      ['region;desc="europe-west3"', "custom;dur=24.0"]
    );
  });

  it("records what a timer measured", () => {
    const timings = makeServerTiming();
    const entries = run(
      timings,
      Effect.andThen(
        startTime({ description: "Query", name: "db" }),
        endTime({ name: "db" })
      )
    );

    assert.lengthOf(entries, 1);
    assert.match(entries[0] ?? "", /^db;dur=\d+\.\d;desc="Query"$/u);
    assert.strictEqual(timings.timers.size, 0);
  });

  it("ignores a timer that is not running", () => {
    assert.deepStrictEqual(
      run(makeServerTiming(), endTime({ name: "db" })),
      []
    );
  });

  it("times an effect that fails, and keeps the failure", () => {
    const timings = makeServerTiming();
    const exit = Effect.runSyncExit(
      Effect.fail("nope").pipe(
        timed({ name: "db" }),
        Effect.provideService(ServerTiming, timings)
      )
    );

    assert.isTrue(exit._tag === "Failure");
    assert.lengthOf(timings.entries, 1);
    assert.match(timings.entries[0] ?? "", /^db;dur=\d+\.\d$/u);
  });

  // Outside a request there is no `ServerTiming` to record into. That is not an
  // error, it is just not a request — see the reference in `timing.ts`.
  it("does nothing outside a request", () => {
    assert.strictEqual(
      Effect.runSync(
        Effect.andThen(setMetric({ name: "region" }), ServerTiming)
      ),
      undefined
    );
  });
});
