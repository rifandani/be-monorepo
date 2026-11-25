import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Logger, Schema } from "effect";
import {
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import {
  errorMessage,
  failureClass,
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

const FAULT_MESSAGES = new Set([
  "Bad Gateway",
  "Service Unavailable",
  "Gateway Timeout",
]);

const logLevelOf = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* logged() {
    const levels: string[] = [];

    const collector = Logger.make((options) => {
      levels.push(options.logLevel);
    });

    yield* toErrorResponse(cause).pipe(
      Effect.provide(Logger.layer([collector]))
    );

    return levels;
  });

const parseFailure = (description: string) =>
  Cause.fail(
    new HttpServerError.HttpServerError({
      reason: new HttpServerError.RequestParseError({ description, request }),
    })
  );

describe(failureClass, () => {
  it("should call a rejected request a refusal", () => {
    assert.strictEqual(failureClass(404), "refusal");
  });

  it("should call an unavailable dependency an infrastructure fault", () => {
    assert.strictEqual(failureClass(503), "fault");
  });

  it("should call an internal server error a defect", () => {
    assert.strictEqual(failureClass(500), "defect");
  });

  it.prop(
    "should always call a 4xx status a refusal",
    [ClientErrorStatus],
    ([status]) => {
      assert.strictEqual(failureClass(status), "refusal");
    }
  );
});

describe(errorMessage, () => {
  it("tells a client what it got wrong", () => {
    assert.strictEqual(
      errorMessage(400, Cause.fail(new Error("payload is not a HealthReport"))),
      "payload is not a HealthReport"
    );
  });

  it("tells a client only the reason phrase of an infrastructure fault", () => {
    assert.strictEqual(
      errorMessage(503, Cause.fail(new Error("pool exhausted"))),
      "Service Unavailable"
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

      assert.isTrue(
        told === SERVER_ERROR_MESSAGE || FAULT_MESSAGES.has(told),
        `told ${told}`
      );
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

  it.effect("tells a refused client where the request is wrong", () =>
    Effect.gen(function* refused() {
      const response = yield* toErrorResponse(
        parseFailure("expected a JSON body")
      );

      const body = (yield* bodyOf(response)) as Record<string, unknown>;

      assert.strictEqual(body.location, "body");
      assert.isString(body.fix);
    })
  );

  it.effect("logs a refusal at the info level", () =>
    Effect.map(logLevelOf(parseFailure("expected a JSON body")), (levels) => {
      assert.deepStrictEqual(levels, ["Info"]);
    })
  );

  it.effect("logs an infrastructure fault at the warning level", () =>
    Effect.map(logLevelOf(Cause.interrupt()), (levels) => {
      assert.deepStrictEqual(levels, ["Warn"]);
    })
  );

  it.effect("logs a defect at the error level", () =>
    Effect.map(logLevelOf(Cause.die(new Error("boom"))), (levels) => {
      assert.deepStrictEqual(levels, ["Error"]);
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
