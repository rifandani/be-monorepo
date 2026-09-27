import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { HttpServerResponse } from "effect/unstable/http";

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
        yield* Effect.promise(() => HttpServerResponse.toWeb(response).text()),
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
});
