import { assert, describe, it } from "@effect/vitest";
import {
  Arbitrary,
  Deferred,
  Effect,
  Fiber,
  Metric,
  Schema,
  Semaphore,
} from "effect";
import { HttpServerResponse } from "effect/http";

import { RETRY_AFTER_SECONDS, withAdmission } from "./admission.ts";
import { admissionRejections, bulkheadAttributes } from "./metrics.ts";

const OK = HttpServerResponse.text("done");

const Limit = Arbitrary.map(
  Arbitrary.schema(Schema.Int),
  (value) => (Math.abs(value) % 32) + 1
);

const Extra = Arbitrary.map(
  Arbitrary.schema(Schema.Int),
  (value) => Math.abs(value) % 32
);

const bodyOf = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(async () => HttpServerResponse.toWeb(response).json());

const heldUntil = (release: Deferred.Deferred<boolean>) =>
  Effect.as(Deferred.await(release), OK);

describe(withAdmission, () => {
  it.effect("should let a request through when a slot is free", () =>
    Effect.gen(function* free() {
      const semaphore = yield* Semaphore.make(1);

      const response = yield* withAdmission(
        semaphore,
        "requests"
      )(Effect.succeed(OK));

      assert.strictEqual(response, OK);
    })
  );

  it.effect(
    "should answer 503 with Retry-After to the request after the limit",
    () =>
      Effect.gen(function* full() {
        const semaphore = yield* Semaphore.make(1);
        const release = yield* Deferred.make<boolean>();

        const first = yield* Effect.forkChild(
          withAdmission(semaphore, "requests")(heldUntil(release))
        );

        yield* Effect.yieldNow;

        const response = yield* withAdmission(
          semaphore,
          "requests"
        )(Effect.succeed(OK));

        assert.strictEqual(response.status, 503);
        assert.strictEqual(
          response.headers["retry-after"],
          String(RETRY_AFTER_SECONDS)
        );
        assert.deepStrictEqual(yield* bodyOf(response), {
          message: "Service Unavailable",
        });

        yield* Deferred.succeed(release, true);
        yield* Fiber.join(first);
      })
  );

  it.effect("should not run the handler of a request it rejects", () =>
    Effect.gen(function* notRun() {
      const semaphore = yield* Semaphore.make(0);
      let ran = false;

      const handler = Effect.sync(() => {
        ran = true;

        return OK;
      });

      yield* withAdmission(semaphore, "requests")(handler);

      assert.isFalse(ran);
    })
  );

  it.effect("should count a rejection under the name of its bulkhead", () =>
    Effect.provideService(
      Effect.gen(function* counted() {
        const semaphore = yield* Semaphore.make(0);

        yield* withAdmission(semaphore, "probes")(Effect.succeed(OK));

        const probes = yield* Metric.value(
          Metric.withAttributes(
            admissionRejections,
            bulkheadAttributes("probes")
          )
        );

        const requests = yield* Metric.value(
          Metric.withAttributes(
            admissionRejections,
            bulkheadAttributes("requests")
          )
        );

        assert.strictEqual(probes.count, 1);
        assert.strictEqual(requests.count, 0);
      }),
      Metric.MetricRegistry,
      new Map()
    )
  );

  it.effect("should count no rejection when a slot is free", () =>
    Effect.provideService(
      Effect.gen(function* notCounted() {
        const semaphore = yield* Semaphore.make(1);

        yield* withAdmission(semaphore, "requests")(Effect.succeed(OK));

        const requests = yield* Metric.value(
          Metric.withAttributes(
            admissionRejections,
            bulkheadAttributes("requests")
          )
        );

        assert.strictEqual(requests.count, 0);
      }),
      Metric.MetricRegistry,
      new Map()
    )
  );

  it.effect("should give the slot back when the handler fails", () =>
    Effect.gen(function* failed() {
      const semaphore = yield* Semaphore.make(1);

      yield* Effect.flip(
        withAdmission(semaphore, "requests")(Effect.fail("boom"))
      );

      const response = yield* withAdmission(
        semaphore,
        "requests"
      )(Effect.succeed(OK));

      assert.strictEqual(response, OK);
    })
  );

  it.effect("should give the slot back when the request is interrupted", () =>
    Effect.gen(function* interrupted() {
      const semaphore = yield* Semaphore.make(1);

      const fiber = yield* Effect.forkChild(
        withAdmission(semaphore, "requests")(Effect.never)
      );

      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);

      const response = yield* withAdmission(
        semaphore,
        "requests"
      )(Effect.succeed(OK));

      assert.strictEqual(response, OK);
    })
  );

  it.effect.prop(
    "should always admit exactly the limit when more requests are in flight",
    [Limit, Extra],
    ([limit, extra]) =>
      Effect.gen(function* admitted() {
        const semaphore = yield* Semaphore.make(limit);
        const release = yield* Deferred.make<boolean>();

        const fibers = yield* Effect.forEach(
          Array.from({ length: limit + extra }),
          () =>
            Effect.forkChild(
              withAdmission(semaphore, "requests")(heldUntil(release))
            )
        );

        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, true);
        const responses = yield* Fiber.joinAll(fibers);

        assert.strictEqual(
          responses.filter((response) => response === OK).length,
          limit
        );
        assert.strictEqual(
          responses.filter((response) => response.status === 503).length,
          extra
        );
      })
  );
});
