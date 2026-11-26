import { afterAll, assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { Api } from "#app/api.ts";
import { chain } from "#app/chain.ts";
import { healthHandlers } from "#app/health.ts";
import { READY_PATH } from "#features/health/api.ts";
import { Unhealthy } from "#features/health/schema.ts";
import { Health } from "#features/health/service.ts";
import type { BreakerPolicy } from "#server/breaker.ts";
import { makeBreaker } from "#server/breaker.ts";
import { OutcomeUnknown } from "#server/timeout.ts";

const ALLOWED_ORIGIN = "https://effect.be-monorepo.localhost";

const POLICY: BreakerPolicy = { cooldownMillis: 60_000, threshold: 2 };

const CHARGE_PATH = "/charge";

let dependencyCalls = 0;

const slowDependency = Effect.suspend(() => {
  dependencyCalls += 1;

  return Effect.fail(new OutcomeUnknown({ operation: "payments.charge" }));
});

const withBreaker = Layer.unwrap(
  Effect.gen(function* makeApp() {
    const breaker = yield* makeBreaker("payments", POLICY);

    const charge = HttpRouter.add(
      "GET",
      CHARGE_PATH,
      Effect.as(
        breaker.protect(slowDependency),
        HttpServerResponse.text("charged")
      )
    );

    const health = HttpApiBuilder.layer(Api).pipe(
      Layer.provide(
        healthHandlers.pipe(
          Layer.provide(Layer.succeed(Health)(Health.make([breaker.readiness])))
        )
      )
    );

    return Layer.mergeAll(charge, health, chain({}));
  })
);

const { dispose, handler } = HttpRouter.toWebHandler(
  withBreaker.pipe(
    Layer.provide([
      HttpServer.layerServices,
      ConfigProvider.layer(
        ConfigProvider.fromEnvRecord({ APP_URL: `${ALLOWED_ORIGIN}/` })
      ),
    ])
  ),
  { disableLogger: true }
);

const send = async (path: string) =>
  handler(new Request(`http://localhost${path}`));

describe("the circuit breaker", () => {
  afterAll(async () => dispose());

  it("should fail fast with 503 and Retry-After once the dependency trips it, and report it to readiness", async () => {
    const ready = await send(READY_PATH);
    const timedOut = await send(CHARGE_PATH);
    await send(CHARGE_PATH);
    const callsWhenOpened = dependencyCalls;

    const rejected = await send(CHARGE_PATH);
    const unready = await send(READY_PATH);

    assert.strictEqual(ready.status, 200);
    assert.strictEqual(timedOut.status, 504);
    assert.strictEqual(rejected.status, 503);
    assert.strictEqual(rejected.headers.get("retry-after"), "60");
    assert.deepStrictEqual(await rejected.json(), {
      message: "Service Unavailable",
    });
    assert.strictEqual(dependencyCalls, callsWhenOpened);
    assert.strictEqual(unready.status, 503);
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(Unhealthy)(await unready.json()).checks,
      [{ name: "circuit:payments", status: "fail" }]
    );
  });
});
