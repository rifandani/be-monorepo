import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Duration, Effect, Fiber, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { withTimeout } from "./timeout.ts";

const DURATION = Duration.seconds(1);
const OK = HttpServerResponse.text("Hello");

const Milliseconds = Arbitrary.schema(Schema.Int).pipe(
  Arbitrary.map((value) => Math.abs(value))
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
