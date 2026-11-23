import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { RequestId } from "./request-id.ts";

const read = Effect.gen(function* read() {
  return yield* RequestId;
});

describe(RequestId, () => {
  it.effect("is empty outside a request", () =>
    Effect.map(read, (id) => {
      assert.strictEqual(id, "");
    })
  );

  it.effect("reads what the middleware provided", () =>
    Effect.gen(function* provided() {
      const id = yield* Effect.provideService(read, RequestId, "abc");

      assert.strictEqual(id, "abc");
    })
  );
});
