import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpMiddleware } from "effect/http";

import { LIVE_PATH, READY_PATH, STARTUP_PATH } from "#features/health/api.ts";
import { pathOf } from "#server/probes.ts";

import { isUntracedProbe, tracerDisabledForProbes } from "./probes.ts";

describe(pathOf, () => {
  it("returns a bare path unchanged", () => {
    assert.strictEqual(pathOf("/health/live"), "/health/live");
  });

  it("drops a query string", () => {
    assert.strictEqual(pathOf("/health/live?verbose=1"), "/health/live");
  });

  it("drops a fragment", () => {
    assert.strictEqual(pathOf("/health/live#anchor"), "/health/live");
  });

  it("drops both, whichever comes first", () => {
    assert.strictEqual(pathOf("/health/live#a?b=1"), "/health/live");
  });

  it("returns an empty path for a url that is only a query", () => {
    assert.strictEqual(pathOf("?lang=id"), "");
  });
});

describe(isUntracedProbe, () => {
  it("drops the span for the startup and liveness probes", () => {
    assert.isTrue(isUntracedProbe(STARTUP_PATH));
    assert.isTrue(isUntracedProbe(LIVE_PATH));
  });

  it("keeps the span for the readiness probe", () => {
    assert.isFalse(isUntracedProbe(READY_PATH));
  });

  it("keeps the span for everything else", () => {
    assert.isFalse(isUntracedProbe("/openapi"));
  });
});

const request = (url: string) =>
  ({ url }) as HttpServerRequest.HttpServerRequest;

const isDisabled = (url: string) =>
  Effect.provide(
    Effect.map(HttpMiddleware.TracerDisabledWhen, (disabled) =>
      disabled(request(url))
    ),
    tracerDisabledForProbes
  );

describe("the tracer-disabled layer", () => {
  it.effect("disables the tracer for the startup and liveness probes", () =>
    Effect.gen(function* probes() {
      assert.isTrue(yield* isDisabled(STARTUP_PATH));
      assert.isTrue(yield* isDisabled(LIVE_PATH));
    })
  );

  it.effect("leaves the tracer on for the readiness probe", () =>
    Effect.gen(function* readiness() {
      assert.isFalse(yield* isDisabled(READY_PATH));
    })
  );

  it.effect("leaves the tracer on for ordinary traffic", () =>
    Effect.gen(function* ordinary() {
      assert.isFalse(yield* isDisabled("/openapi"));
    })
  );
});
