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

/** Any 4xx status. */
const ClientErrorStatus = Schema.Int.check(
  Schema.isBetween({ maximum: 499, minimum: 400 })
);

/** Any 5xx status. */
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

  it.prop(
    "should never tell a client the message of a server failure",
    [ServerErrorStatus, Schema.String, Schema.Boolean],
    ([status, message, died]) => {
      // Arrange
      const error = new Error(message);
      const cause = died ? Cause.die(error) : Cause.fail(error);

      // Act
      const told = errorMessage(status, cause);

      // Assert
      assert.strictEqual(told, SERVER_ERROR_MESSAGE);
    }
  );

  it.prop(
    "should always tell a client the message of its own error",
    [ClientErrorStatus, Schema.String],
    ([status, message]) => {
      // Arrange
      const cause = Cause.fail(new Error(message));

      // Act
      const told = errorMessage(status, cause);

      // Assert
      assert.strictEqual(told, message);
    }
  );
});

describe(toErrorResponse, () => {
  // A handler that throws dies rather than failing, so a catch on the error
  // channel alone would never see this one.
  it.effect("answers a defect with a 500 and no detail", () =>
    Effect.gen(function* died() {
      // Act
      const response = yield* toErrorResponse(
        Cause.die(new Error("connect ECONNREFUSED 5432"))
      );

      // Assert
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
        // Act
        const response = yield* toErrorResponse(Cause.die(new Error(message)));

        // Assert
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
      // Act
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

      // Assert
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
      // Arrange
      const chosenResponse = HttpServerResponse.jsonUnsafe(
        { message: "over quota", retryAfter: 30 },
        { status: 429 }
      );

      // Act
      const response = yield* toErrorResponse(Cause.die(chosenResponse));

      // Assert
      assert.strictEqual(response.status, 429);
      assert.deepStrictEqual(yield* bodyOf(response), {
        message: "over quota",
        retryAfter: 30,
      });
    })
  );
});
