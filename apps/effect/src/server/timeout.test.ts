import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { HttpServerResponse } from "effect/unstable/http";

import { TIMEOUT, withTimeout } from "./timeout.js";

// The middleware wires `withTimeout` to `TIMEOUT`, which is 15 seconds — too
// long to wait out, and not the part worth testing. What is worth testing is
// the combinator: that it lets a response through, that it answers 504 rather
// than hanging, and that it stops the work it gave up on.
//
// `it.effect` supplies a `TestClock`, so these run at the real duration and
// take no time at all: `TestClock.adjust` moves the clock, and the warning the
// timeout branch logs goes to the test console rather than the terminal.
const OK = HttpServerResponse.text("Hello");

describe(withTimeout, () => {
  it.effect("lets a response through", () =>
    Effect.gen(function* through() {
      const response = yield* withTimeout(TIMEOUT)(Effect.succeed(OK));

      assert.strictEqual(response.status, 200);
    })
  );

  it.effect("answers 504 once the duration is up", () =>
    Effect.gen(function* timedOut() {
      const fiber = yield* Effect.forkChild(withTimeout(TIMEOUT)(Effect.never));

      yield* TestClock.adjust(TIMEOUT);

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
      const fiber = yield* Effect.forkChild(withTimeout(TIMEOUT)(held));

      yield* TestClock.adjust(TIMEOUT);
      yield* Fiber.join(fiber);

      assert.isTrue(released);
    })
  );

  it("waits the 15 seconds apps/hono waits", () => {
    assert.strictEqual(Duration.toMillis(TIMEOUT), 15_000);
  });
});
