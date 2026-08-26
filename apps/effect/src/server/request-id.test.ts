import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { RequestId } from "./request-id.js";

// The middleware itself is covered through the composed app in
// `tests/app.test.ts`. What is left is the reference a handler reads, and the
// only part of it a request never exercises is its default.
const read = Effect.gen(function* read() {
  return yield* RequestId;
});

describe(RequestId, () => {
  it("is empty outside a request", () => {
    assert.strictEqual(Effect.runSync(read), "");
  });

  it("reads what the middleware provided", () => {
    assert.strictEqual(
      Effect.runSync(read.pipe(Effect.provideService(RequestId, "abc"))),
      "abc"
    );
  });
});
