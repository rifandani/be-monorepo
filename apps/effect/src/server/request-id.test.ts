import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { RequestId } from "./request-id.ts";

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
