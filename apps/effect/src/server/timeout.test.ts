import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Duration, Effect, Fiber, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { withTimeout } from "./timeout.ts";

// The middleware wires `withTimeout` to the app's own 15 seconds, and that
// wiring is not the part worth testing — a constant asserted against itself
// proves nothing. What is worth testing is the combinator: that it lets a
// response through, that it answers 504 rather than hanging, and that it stops
// the work it gave up on. So these drive it with a duration of their own, which
// is also what keeps `TIMEOUT` private to the module.
//
// `it.effect` supplies a `TestClock`, so these take no time at all whatever the
// duration is: `TestClock.adjust` moves the clock, and the warning the timeout
// branch logs goes to the test console rather than the terminal.
const DURATION = Duration.seconds(1);
const OK = HttpServerResponse.text("Hello");

/** Any duration in whole milliseconds, zero included. */
const Milliseconds = Arbitrary.schema(Schema.Int).pipe(
  Arbitrary.map((value) => Math.abs(value))
);

describe(withTimeout, () => {
  it.effect("lets a response through", () =>
    Effect.gen(function* through() {
      // Act
      const response = yield* withTimeout(DURATION)(Effect.succeed(OK));

      // Assert
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

  // `hono/timeout` races a promise and answers whichever settles first, which
  // leaves the handler it gave up on running. Interruption is the whole reason
  // to prefer this.
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
        // Arrange
        const duration = Duration.millis(limit + spare + 1);
        const handler = Effect.as(Effect.sleep(Duration.millis(limit)), OK);

        // Act
        const fiber = yield* Effect.forkChild(withTimeout(duration)(handler));
        yield* TestClock.adjust(Duration.millis(limit));

        const response = yield* Fiber.join(fiber);

        // Assert
        assert.strictEqual(response, OK);
      })
  );

  it.effect.prop(
    "should always answer 504 for a request that ends late",
    [Milliseconds, Milliseconds],
    ([limit, late]) =>
      Effect.gen(function* tooLate() {
        // Arrange
        const duration = Duration.millis(limit);

        const handler = Effect.as(
          Effect.sleep(Duration.millis(limit + late + 1)),
          OK
        );

        // Act
        const fiber = yield* Effect.forkChild(withTimeout(duration)(handler));
        yield* TestClock.adjust(duration);

        const response = yield* Fiber.join(fiber);

        // Assert
        assert.strictEqual(response.status, 504);
      })
  );
});
