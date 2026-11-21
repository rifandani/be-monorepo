import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Schema } from "effect";
import {
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import {
  errorMessage,
  SERVER_ERROR_MESSAGE,
  toErrorResponse,
} from "./error.ts";

const request = HttpServerRequest.fromWeb(new Request("http://localhost/"));

const bodyOf = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(async () => HttpServerResponse.toWeb(response).json());

const ClientErrorStatus = Schema.Int.check(
  Schema.isBetween({ maximum: 499, minimum: 400 })
);

const ServerErrorStatus = Schema.Int.check(
  Schema.isBetween({ maximum: 599, minimum: 500 })
);

describe(errorMessage, () => {
  it("tells a client what it got wrong", () => {
    assert.strictEqual(
      errorMessage(400, Cause.fail(new Error("payload is not a HealthReport"))),
      "payload is not a HealthReport"
    );
  });

  it("tells a client nothing about a server failure", () => {
    assert.strictEqual(
      errorMessage(500, Cause.die(new Error("connect ECONNREFUSED 5432"))),
      SERVER_ERROR_MESSAGE
    );
  });

  it("falls back when the cause carries no message", () => {
    assert.strictEqual(errorMessage(400, Cause.empty), SERVER_ERROR_MESSAGE);
  });

  it.prop(
    "should never tell a client the message of a server failure",
    [ServerErrorStatus, Schema.String, Schema.Boolean],
    ([status, message, died]) => {
      const error = new Error(message);
      const cause = died ? Cause.die(error) : Cause.fail(error);

      const told = errorMessage(status, cause);

      assert.strictEqual(told, SERVER_ERROR_MESSAGE);
    }
  );

  it.prop(
    "should always tell a client the message of its own error",
    [ClientErrorStatus, Schema.String],
    ([status, message]) => {
      const cause = Cause.fail(new Error(message));

      const told = errorMessage(status, cause);

      assert.strictEqual(told, message);
    }
  );
});

describe(toErrorResponse, () => {
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

  it.effect.prop(
    "should never put the message of a defect in the response body",
    [Schema.String],
    ([message]) =>
      Effect.gen(function* defect() {
        const response = yield* toErrorResponse(Cause.die(new Error(message)));

        assert.strictEqual(response.status, 500);
        assert.deepStrictEqual(yield* bodyOf(response), {
          message: SERVER_ERROR_MESSAGE,
        });
      })
  );

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
