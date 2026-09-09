import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { HttpServerRequest } from "effect/unstable/http";
import { HttpMiddleware } from "effect/unstable/http";

import { LIVE_PATH, READY_PATH, STARTUP_PATH } from "#api/health.ts";

import {
  isProbe,
  isUntracedProbe,
  pathOf,
  tracerDisabledForProbes,
} from "./probes.ts";

// The middleware is covered through the composed app in `tests/app.test.ts`.
// What is left is the policy: which url is a probe, and which probe is traced.

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

describe(isProbe, () => {
  it("recognises all three probes", () => {
    for (const path of [STARTUP_PATH, LIVE_PATH, READY_PATH]) {
      assert.isTrue(isProbe(path));
    }
  });

  // The exclusion is what keeps a probe out of the logs, so a query string
  // getting past it would put the traffic straight back in.
  it("recognises a probe with a query string", () => {
    assert.isTrue(isProbe(`${LIVE_PATH}?x=1`));
  });

  it("does not recognise another path", () => {
    assert.isFalse(isProbe("/openapi"));
    assert.isFalse(isProbe("/"));
  });

  // There is no bare `/health` endpoint, so it is not a probe either.
  it("does not recognise the prefix on its own", () => {
    assert.isFalse(isProbe("/health"));
  });

  it("does not recognise a path that merely starts with a probe path", () => {
    assert.isFalse(isProbe("/health/liveness"));
  });
});

describe(isUntracedProbe, () => {
  it("drops the span for the startup and liveness probes", () => {
    assert.isTrue(isUntracedProbe(STARTUP_PATH));
    assert.isTrue(isUntracedProbe(LIVE_PATH));
  });

  // The readiness probe runs the checks, so its span is the one that describes
  // something. See the note in `probes.ts`.
  it("keeps the span for the readiness probe", () => {
    assert.isFalse(isUntracedProbe(READY_PATH));
  });

  it("keeps the span for everything else", () => {
    assert.isFalse(isUntracedProbe("/openapi"));
  });
});

// The layer is the only thing standing between the policy above and the tracer,
// and the tracer is applied by the entrypoints — which no test builds. So the
// predicate is read back out of the reference the layer provides. A layer wired
// to the wrong predicate, or to none, is what this catches.
// Only `url` is read, and only by `isUntracedProbe`.
const request = (url: string) =>
  ({ url }) as HttpServerRequest.HttpServerRequest;

describe("the tracer-disabled layer", () => {
  const disabled = Effect.runSync(
    Effect.provide(HttpMiddleware.TracerDisabledWhen, tracerDisabledForProbes)
  );

  it("disables the tracer for the startup and liveness probes", () => {
    assert.isTrue(disabled(request(STARTUP_PATH)));
    assert.isTrue(disabled(request(LIVE_PATH)));
  });

  it("leaves the tracer on for the readiness probe", () => {
    assert.isFalse(disabled(request(READY_PATH)));
  });

  it("leaves the tracer on for ordinary traffic", () => {
    assert.isFalse(disabled(request("/openapi")));
  });
});
