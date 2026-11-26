import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Cause, Duration, Effect, Fiber, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";

import type { BreakerPolicy, Ticket } from "./breaker.ts";
import {
  BREAKER_POLICY,
  BreakerState,
  CLOSED,
  CircuitOpen,
  admit,
  makeBreaker,
  settle,
  statusAt,
} from "./breaker.ts";
import { toErrorResponse } from "./error.ts";
import { OUTBOUND_TIMEOUT, OutcomeUnknown } from "./timeout.ts";

const POLICY: BreakerPolicy = { cooldownMillis: 30_000, threshold: 3 };

const HALF_OPEN = BreakerState.HalfOpen({ since: 0 });

const failTimes = (
  times: number,
  now: number,
  from: BreakerState = CLOSED
): BreakerState =>
  Array.from({ length: times }).reduce<BreakerState>(
    (state) => settle(state, "call", "fault", now, POLICY),
    from
  );

const OPEN_AT_ZERO = failTimes(POLICY.threshold, 0);

const Elapsed = Arbitrary.map(Arbitrary.schema(Schema.Int), (value) =>
  Math.abs(value)
);

const Call = Schema.TaggedStruct("Call", {});

const Finish = Schema.TaggedStruct("Finish", {
  outcome: Schema.Literals(["success", "fault", "refusal", "interrupted"]),
});

const Wait = Schema.TaggedStruct("Wait", {
  millis: Schema.Int.check(Schema.isBetween({ maximum: 60_000, minimum: 0 })),
});

const Step = Schema.Union([Call, Finish, Wait]);

type Step = typeof Step.Type;

const Steps = Arbitrary.schema(Schema.Array(Step));

interface Run {
  readonly inFlight: readonly Ticket[];
  readonly now: number;
  readonly state: BreakerState;
}

const callAt = (current: Run): Run => {
  const decision = admit(current.state, current.now);

  return decision.ticket === undefined
    ? { ...current, state: decision.state }
    : {
        ...current,
        inFlight: [...current.inFlight, decision.ticket],
        state: decision.state,
      };
};

const finishOldest = (
  current: Run,
  outcome: (typeof Finish.Type)["outcome"]
) => {
  const [ticket, ...rest] = current.inFlight;

  if (ticket === undefined) {
    return current;
  }

  return {
    ...current,
    inFlight: rest,
    state: settle(current.state, ticket, outcome, current.now, POLICY),
  };
};

const step = (current: Run, next: Step): Run => {
  if (Schema.is(Wait)(next)) {
    return { ...current, now: current.now + next.millis };
  }

  return Schema.is(Finish)(next)
    ? finishOldest(current, next.outcome)
    : callAt(current);
};

const START: Run = { inFlight: [], now: 0, state: CLOSED };

const run = (steps: readonly Step[]): Run => steps.reduce(step, START);

const history = (steps: readonly Step[]): readonly Run[] => {
  const runs: Run[] = [START];
  let current = START;

  for (const next of steps) {
    current = step(current, next);
    runs.push(current);
  }

  return runs;
};

const TRIP: readonly Step[] = Array.from({ length: POLICY.threshold }).flatMap(
  (): Step[] => [Call.make({}), Finish.make({ outcome: "fault" })]
);

const tripRun = (steps: readonly Step[]): Run => {
  const current = run(steps);

  const drained = current.inFlight.reduce<Run>(
    (pending) => finishOldest(pending, "interrupted"),
    current
  );

  return TRIP.reduce(step, drained);
};

const withoutProbe = (state: BreakerState): BreakerState =>
  BreakerState.$is("HalfOpen")(state)
    ? settle(state, "probe", "interrupted", 0, POLICY)
    : state;

class Refused extends Schema.TaggedError<Refused>()("Refused", {}) {
  readonly status = 422;
}

const DEPENDENCY = "payments";

const COOLDOWN = Duration.millis(POLICY.cooldownMillis);

const timedOut = Effect.fail(
  new OutcomeUnknown({ operation: "payments.charge" })
);

const bodyOf = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(async () => HttpServerResponse.toWeb(response).json());

const tripped = Effect.gen(function* trip() {
  const breaker = yield* makeBreaker(DEPENDENCY, POLICY);

  yield* Effect.forEach(
    Array.from({ length: POLICY.threshold }),
    () => Effect.ignore(breaker.protect(timedOut)),
    { concurrency: 1 }
  );

  return breaker;
});

describe(admit, () => {
  it("should let a call through when the breaker is closed", () => {
    const decision = admit(CLOSED, 0);

    assert.deepStrictEqual(decision, { state: CLOSED, ticket: "call" });
  });

  it("should reject a call while the breaker is open", () => {
    const decision = admit(OPEN_AT_ZERO, POLICY.cooldownMillis - 1);

    assert.deepStrictEqual(decision, {
      retryAfterMillis: 1,
      state: OPEN_AT_ZERO,
      ticket: undefined,
    });
  });

  it("should let one probe through once the cooldown is over", () => {
    const decision = admit(OPEN_AT_ZERO, POLICY.cooldownMillis);

    assert.deepStrictEqual(decision, {
      state: BreakerState.HalfOpen({ since: POLICY.cooldownMillis }),
      ticket: "probe",
    });
  });

  it("should reject the other calls while the probe is in flight", () => {
    const decision = admit(HALF_OPEN, 0);

    assert.deepStrictEqual(decision, {
      retryAfterMillis: 0,
      state: HALF_OPEN,
      ticket: undefined,
    });
  });
});

describe(settle, () => {
  it("should open the breaker after the threshold of consecutive faults", () => {
    const state = failTimes(POLICY.threshold, 1000);

    assert.deepStrictEqual(
      state,
      BreakerState.Open({ until: 1000 + POLICY.cooldownMillis })
    );
  });

  it("should stay closed for one fault less than the threshold", () => {
    const state = failTimes(POLICY.threshold - 1, 0);

    assert.deepStrictEqual(
      state,
      BreakerState.Closed({ failures: POLICY.threshold - 1 })
    );
  });

  it("should start the count again after a success", () => {
    const almost = failTimes(POLICY.threshold - 1, 0);

    const state = settle(almost, "call", "success", 0, POLICY);

    assert.deepStrictEqual(state, CLOSED);
  });

  it("should not count a refusal as a fault", () => {
    const almost = failTimes(POLICY.threshold - 1, 0);

    const state = settle(almost, "call", "refusal", 0, POLICY);

    assert.deepStrictEqual(state, CLOSED);
  });

  it("should close the breaker when the probe succeeds", () => {
    const state = settle(HALF_OPEN, "probe", "success", 0, POLICY);

    assert.deepStrictEqual(state, CLOSED);
  });

  it("should open the breaker again when the probe fails", () => {
    const state = settle(HALF_OPEN, "probe", "fault", 500, POLICY);

    assert.deepStrictEqual(
      state,
      BreakerState.Open({ until: 500 + POLICY.cooldownMillis })
    );
  });

  it("should let the next call probe when the probe is interrupted", () => {
    const state = settle(HALF_OPEN, "probe", "interrupted", 500, POLICY);

    assert.strictEqual(admit(state, 500).ticket, "probe");
  });

  it("should ignore a late result of a call that started before the breaker opened", () => {
    const state = settle(OPEN_AT_ZERO, "call", "success", 1, POLICY);

    assert.deepStrictEqual(state, OPEN_AT_ZERO);
  });

  it("should ignore a late result of a call while the probe is in flight", () => {
    const state = settle(HALF_OPEN, "call", "success", 1, POLICY);

    assert.deepStrictEqual(state, HALF_OPEN);
  });
});

describe(statusAt, () => {
  it("should report each state by its name", () => {
    assert.deepStrictEqual(
      [statusAt(CLOSED, 0), statusAt(OPEN_AT_ZERO, 0), statusAt(HALF_OPEN, 0)],
      ["closed", "open", "half-open"]
    );
  });

  it("should report half-open once the cooldown of an open breaker is over", () => {
    assert.strictEqual(
      statusAt(OPEN_AT_ZERO, POLICY.cooldownMillis),
      "half-open"
    );
  });
});

describe(makeBreaker, () => {
  it.effect("should give the result of a call while closed", () =>
    Effect.gen(function* closed() {
      const breaker = yield* makeBreaker(DEPENDENCY, POLICY);

      const result = yield* breaker.protect(Effect.succeed("charged"));

      assert.strictEqual(result, "charged");
      assert.strictEqual(yield* breaker.status, "closed");
    })
  );

  it.effect(
    "should fail fast without the call after the threshold of faults",
    () =>
      Effect.gen(function* open() {
        const breaker = yield* tripped;
        let called = false;

        const error = yield* Effect.flip(
          breaker.protect(
            Effect.sync(() => {
              called = true;
            })
          )
        );

        assert.instanceOf(error, CircuitOpen);
        assert.strictEqual(error.dependency, DEPENDENCY);
        assert.strictEqual(error.retryAfterSeconds, 30);
        assert.isFalse(called);
        assert.strictEqual(yield* breaker.status, "open");
      })
  );

  it.effect("should keep the failure of the call it lets through", () =>
    Effect.gen(function* failure() {
      const breaker = yield* makeBreaker(DEPENDENCY, POLICY);

      const error = yield* Effect.flip(breaker.protect(timedOut));

      assert.instanceOf(error, OutcomeUnknown);
    })
  );

  it.effect("should not open for refusals of the dependency", () =>
    Effect.gen(function* refusals() {
      const breaker = yield* makeBreaker(DEPENDENCY, POLICY);

      yield* Effect.forEach(
        Array.from({ length: POLICY.threshold }),
        () => Effect.ignore(breaker.protect(Effect.fail(new Refused()))),
        { concurrency: 1 }
      );

      assert.strictEqual(yield* breaker.status, "closed");
    })
  );

  it.effect("should count a defect as a fault", () =>
    Effect.gen(function* defects() {
      const breaker = yield* makeBreaker(DEPENDENCY, POLICY);

      yield* Effect.forEach(
        Array.from({ length: POLICY.threshold }),
        () => Effect.exit(breaker.protect(Effect.die("client blew up"))),
        { concurrency: 1 }
      );

      assert.strictEqual(yield* breaker.status, "open");
    })
  );

  it.effect(
    "should close again when the probe after the cooldown succeeds",
    () =>
      Effect.gen(function* recovered() {
        const breaker = yield* tripped;

        yield* TestClock.adjust(COOLDOWN);
        const result = yield* breaker.protect(Effect.succeed("charged"));

        assert.strictEqual(result, "charged");
        assert.strictEqual(yield* breaker.status, "closed");
      })
  );

  it.effect("should reject other calls while the probe is in flight", () =>
    Effect.gen(function* probing() {
      const breaker = yield* tripped;
      yield* TestClock.adjust(COOLDOWN);

      const probe = yield* Effect.forkChild(breaker.protect(Effect.never));
      yield* Effect.yieldNow;

      const error = yield* Effect.flip(
        breaker.protect(Effect.succeed("charged"))
      );

      assert.instanceOf(error, CircuitOpen);
      yield* Fiber.interrupt(probe);
    })
  );

  it.effect(
    "should let the next call probe when the probe is interrupted",
    () =>
      Effect.gen(function* interrupted() {
        const breaker = yield* tripped;
        yield* TestClock.adjust(COOLDOWN);

        const probe = yield* Effect.forkChild(breaker.protect(Effect.never));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(probe);
        const result = yield* breaker.protect(Effect.succeed("charged"));

        assert.strictEqual(result, "charged");
      })
  );

  it.effect("should fail its readiness check only while open", () =>
    Effect.gen(function* readiness() {
      const breaker = yield* makeBreaker(DEPENDENCY, POLICY);
      yield* breaker.readiness.verify;

      yield* Effect.forEach(
        Array.from({ length: POLICY.threshold }),
        () => Effect.ignore(breaker.protect(timedOut)),
        { concurrency: 1 }
      );
      const error = yield* Effect.flip(breaker.readiness.verify);
      yield* TestClock.adjust(COOLDOWN);
      yield* breaker.readiness.verify;

      assert.strictEqual(breaker.readiness.name, "circuit:payments");
      assert.include(error.message, "payments");
      assert.strictEqual(yield* breaker.status, "half-open");
    })
  );
});

describe(CircuitOpen, () => {
  it.effect(
    "should answer an open circuit as a 503 fault with Retry-After",
    () =>
      Effect.gen(function* answered() {
        const cause = Cause.fail(
          new CircuitOpen({ dependency: DEPENDENCY, retryAfterSeconds: 7 })
        );

        const response = yield* toErrorResponse(cause);

        assert.strictEqual(response.status, 503);
        assert.strictEqual(response.headers["retry-after"], "7");
        assert.deepStrictEqual(yield* bodyOf(response), {
          message: "Service Unavailable",
        });
      })
  );
});

describe("the breaker policy", () => {
  it("should open after more than one fault", () => {
    assert.isAbove(BREAKER_POLICY.threshold, 1);
  });

  it("should wait longer than one outbound timeout before it probes", () => {
    assert.isTrue(
      Duration.isGreaterThan(
        Duration.millis(BREAKER_POLICY.cooldownMillis),
        OUTBOUND_TIMEOUT
      )
    );
  });
});

describe("the breaker state machine", () => {
  it.prop(
    "should always reject every call while open and before the cooldown ends",
    [Steps, Elapsed],
    ([steps, elapsed]) => {
      const { now, state } = tripRun(steps);

      if (!BreakerState.$is("Open")(state)) {
        assert.fail("the breaker did not open after the threshold of faults");
      }

      const decision = admit(state, now + (elapsed % (state.until - now)));

      assert.isUndefined(decision.ticket);
      assert.strictEqual(decision.state, state);
    }
  );

  it.prop(
    "should never have more than one probe in flight",
    [Steps],
    ([steps]) => {
      for (const { inFlight } of history(steps)) {
        assert.isAtMost(
          inFlight.filter((ticket) => ticket === "probe").length,
          1
        );
      }
    }
  );

  it.prop(
    "should always keep the failure count below the threshold while closed",
    [Steps],
    ([steps]) => {
      for (const { state } of history(steps)) {
        if (BreakerState.$is("Closed")(state)) {
          assert.isBelow(state.failures, POLICY.threshold);
        }
      }
    }
  );

  it.prop(
    "should always open after exactly the threshold of consecutive faults from closed",
    [Steps],
    ([steps]) => {
      for (const { now, state } of history(steps)) {
        if (BreakerState.$is("Closed")(state)) {
          const before = failTimes(
            POLICY.threshold - state.failures - 1,
            now,
            state
          );

          assert.strictEqual(statusAt(before, now), "closed");
          assert.strictEqual(statusAt(failTimes(1, now, before), now), "open");
        }
      }
    }
  );

  it.prop(
    "should always close again after the cooldown and one successful probe",
    [Steps],
    ([steps]) => {
      const { now, state } = run(steps);
      const later = now + POLICY.cooldownMillis;
      const probe = admit(withoutProbe(state), later);

      if (probe.ticket === undefined) {
        assert.fail("the breaker rejected a call after the cooldown");
      }

      assert.deepStrictEqual(
        settle(probe.state, probe.ticket, "success", later, POLICY),
        CLOSED
      );
    }
  );
});
