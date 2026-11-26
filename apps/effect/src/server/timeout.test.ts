import { assert, describe, it } from "@effect/vitest";
import {
  Arbitrary,
  Cause,
  Duration,
  Effect,
  Exit,
  Fiber,
  Schema,
} from "effect";
import { HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { toErrorResponse } from "./error.ts";
import {
  INBOUND_TIMEOUT,
  OUTBOUND_TIMEOUT,
  OutcomeUnknown,
  withOutboundTimeout,
  withTimeout,
} from "./timeout.ts";

const DURATION = Duration.seconds(1);
const OK = HttpServerResponse.text("Hello");

const bodyOf = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(async () => HttpServerResponse.toWeb(response).json());

const Milliseconds = Arbitrary.map(Arbitrary.schema(Schema.Int), (value) =>
  Math.abs(value)
);

describe(withTimeout, () => {
  it.effect("lets a response through", () =>
    Effect.gen(function* through() {
      const response = yield* withTimeout(DURATION)(Effect.succeed(OK));

      assert.strictEqual(response.status, 200);
    })
  );

  it.effect("answers 504 once the duration is up", () =>
    Effect.gen(function* timedOut() {
      const fiber = yield* Effect.forkChild(
        withTimeout(DURATION)(Effect.never)
      );

      yield* TestClock.adjust(DURATION);

      const response = yield* Fiber.join(fiber);

      assert.strictEqual(response.status, 504);
      assert.strictEqual(
        yield* Effect.promise(async () =>
          HttpServerResponse.toWeb(response).text()
        ),
        "Gateway Timeout"
      );
    })
  );

  it.effect("interrupts the request it gave up on", () =>
    Effect.gen(function* interrupted() {
      let released = false;

      const held = Effect.never.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            released = true;
          })
        )
      );

      const fiber = yield* Effect.forkChild(withTimeout(DURATION)(held));

      yield* TestClock.adjust(DURATION);
      yield* Fiber.join(fiber);

      assert.isTrue(released);
    })
  );

  it.effect.prop(
    "should always give the response of a request that ends in time",
    [Milliseconds, Milliseconds],
    ([limit, spare]) =>
      Effect.gen(function* inTime() {
        const duration = Duration.millis(limit + spare + 1);
        const handler = Effect.as(Effect.sleep(Duration.millis(limit)), OK);

        const fiber = yield* Effect.forkChild(withTimeout(duration)(handler));
        yield* TestClock.adjust(Duration.millis(limit));

        const response = yield* Fiber.join(fiber);

        assert.strictEqual(response, OK);
      })
  );

  it.effect.prop(
    "should always answer 504 for a request that ends late",
    [Milliseconds, Milliseconds],
    ([limit, late]) =>
      Effect.gen(function* tooLate() {
        const duration = Duration.millis(limit);

        const handler = Effect.as(
          Effect.sleep(Duration.millis(limit + late + 1)),
          OK
        );

        const fiber = yield* Effect.forkChild(withTimeout(duration)(handler));
        yield* TestClock.adjust(duration);

        const response = yield* Fiber.join(fiber);

        assert.strictEqual(response.status, 504);
      })
  );
});

describe("timeout values", () => {
  it("should give up on an outbound call before the inbound request ends", () => {
    assert.isTrue(Duration.isLessThan(OUTBOUND_TIMEOUT, INBOUND_TIMEOUT));
  });
});

describe(withOutboundTimeout, () => {
  it.effect("should give the result of a call that ends in time", () =>
    Effect.gen(function* inTime() {
      const call = Effect.succeed("charged");

      const result = yield* withOutboundTimeout("payments.charge")(call);

      assert.strictEqual(result, "charged");
    })
  );

  it.effect("should keep the failure of a call that fails in time", () =>
    Effect.gen(function* refused() {
      const call = Effect.fail("card declined");

      const exit = yield* Effect.exit(
        withOutboundTimeout("payments.charge")(call)
      );

      assert.deepStrictEqual(exit, Exit.fail("card declined"));
    })
  );

  it.effect(
    "should fail with OutcomeUnknown, not a refusal, once the outbound timeout is up",
    () =>
      Effect.gen(function* timedOut() {
        const fiber = yield* Effect.forkChild(
          Effect.flip(withOutboundTimeout("payments.charge")(Effect.never))
        );

        yield* TestClock.adjust(OUTBOUND_TIMEOUT);
        const error = yield* Fiber.join(fiber);

        assert.instanceOf(error, OutcomeUnknown);
        assert.strictEqual(error.operation, "payments.charge");
      })
  );

  it.effect.prop(
    "should always give the result of a call that ends before the outbound timeout",
    [Milliseconds],
    ([spare]) =>
      Effect.gen(function* beforeLimit() {
        const before = Math.max(
          0,
          Duration.toMillis(OUTBOUND_TIMEOUT) - spare - 1
        );

        const call = Effect.as(
          Effect.sleep(Duration.millis(before)),
          "charged"
        );

        const fiber = yield* Effect.forkChild(
          withOutboundTimeout("payments.charge")(call)
        );

        yield* TestClock.adjust(Duration.millis(before));
        const result = yield* Fiber.join(fiber);

        assert.strictEqual(result, "charged");
      })
  );
});

describe(OutcomeUnknown, () => {
  it.effect("should answer an unknown outcome as a 504 fault", () =>
    Effect.gen(function* answered() {
      const cause = Cause.fail(
        new OutcomeUnknown({ operation: "payments.charge" })
      );

      const response = yield* toErrorResponse(cause);

      assert.strictEqual(response.status, 504);
      assert.deepStrictEqual(yield* bodyOf(response), {
        message: "Gateway Timeout",
      });
    })
  );
});
