import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import {
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import {
  errorMessage,
  SERVER_ERROR_MESSAGE,
  toErrorResponse,
} from "./error.ts";

const request = HttpServerRequest.fromWeb(new Request("http://localhost/"));

const bodyOf = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(() => HttpServerResponse.toWeb(response).json());

describe(errorMessage, () => {
  it("tells a client what it got wrong", () => {
    assert.strictEqual(
      errorMessage(400, Cause.fail(new Error("payload is not a HealthReport"))),
      "payload is not a HealthReport"
    );
  });

  // The message of a server failure names the module, the query or the host
  // that broke. It goes to the log, not to the client.
  it("tells a client nothing about a server failure", () => {
    assert.strictEqual(
      errorMessage(500, Cause.die(new Error("connect ECONNREFUSED 5432"))),
      SERVER_ERROR_MESSAGE
    );
  });

  it("falls back when the cause carries no message", () => {
    assert.strictEqual(errorMessage(400, Cause.empty), SERVER_ERROR_MESSAGE);
  });
});

describe(toErrorResponse, () => {
  // A handler that throws dies rather than failing, so a catch on the error
  // channel alone would never see this one.
  it.effect("answers a defect with a 500 and no detail", () =>
    Effect.gen(function* died() {
      const response = yield* toErrorResponse(
        Cause.die(new Error("connect ECONNREFUSED 5432"))
      );

      assert.strictEqual(response.status, 500);
      assert.deepStrictEqual(yield* bodyOf(response), {
        message: SERVER_ERROR_MESSAGE,
      });
    })
  );

  // `causeResponse` picks the status from the failure, and this is the check
  // that the middleware leaves that decision to it.
  it.effect("keeps the status the failure asked for", () =>
    Effect.gen(function* parseFailed() {
      const response = yield* toErrorResponse(
        Cause.fail(
          new HttpServerError.HttpServerError({
            reason: new HttpServerError.RequestParseError({
              request,
              description: "expected a JSON body",
            }),
          })
        )
      );

      assert.strictEqual(response.status, 400);
      assert.include(
        ((yield* bodyOf(response)) as { message: string }).message,
        "expected a JSON body"
      );
    })
  );

  // A handler can answer a failure itself by dying with a response. That answer
  // already has a body, so nothing here may overwrite it.
  it.effect("leaves a response a handler chose alone", () =>
    Effect.gen(function* chosen() {
      const chosenResponse = HttpServerResponse.jsonUnsafe(
        { message: "over quota", retryAfter: 30 },
        { status: 429 }
      );
      const response = yield* toErrorResponse(Cause.die(chosenResponse));

      assert.strictEqual(response.status, 429);
      assert.deepStrictEqual(yield* bodyOf(response), {
        message: "over quota",
        retryAfter: 30,
      });
    })
  );
});
