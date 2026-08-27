import type { Layer as LayerType } from "effect";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { APP_TITLE, APP_URL } from "./config.js";
import { observability } from "./observability.js";
import { app } from "./server/http.js";
import { tracerDisabledForProbes } from "./server/probes.js";

// `HttpServer.withLogAddress`, which `HttpRouter.serve` applies, reports the
// socket the process bound to. That is not the address a developer opens —
// portless terminates TLS on a `.localhost` subdomain and forwards here — so
// this logs the public URL alongside it.
const banner = Effect.gen(function* banner() {
  const title = yield* APP_TITLE;
  const url = yield* APP_URL;

  yield* Effect.log(`${title} is reachable at ${url.toString()}`);
});

/**
 * The whole app, wanting only a platform server layer.
 *
 * Everything below is the same on both runtimes, so it is stated once here and
 * `node.ts` and `bun.ts` are left holding what genuinely differs: the platform
 * server and the runtime that runs it. The wiring this composes is the kind
 * that fails quietly when a copy of it drifts — a missing
 * `tracerDisabledForProbes` traces the probes on one runtime and not the other,
 * which no test would catch, and neither entrypoint is covered by one.
 *
 * The server span needs no wiring: `HttpEffect.toHandled`, which every platform
 * `serve` goes through, applies `HttpMiddleware.tracer` itself and wraps the
 * middleware with it — so the span already encloses Effect's own per-request log
 * line, and that line carries a trace id for free. Passing the tracer through
 * `serve`'s `middleware` option produces a *second*, nested server span per
 * request. Verified against a collector; see `docs/observability.md`.
 *
 * `tracerDisabledForProbes` is what that tracer reads to skip the two probes.
 *
 * `Layer.provide` and not `Layer.merge` for the telemetry: it builds first and
 * so releases last, which means the spans and log records emitted while the
 * process is shutting down are still flushed. Merged, the order between the two
 * would be unspecified — and those are the lines most worth having.
 */
export const main = <A, E, R>(platform: LayerType.Layer<A, E, R>) =>
  Layer.provide(
    HttpRouter.serve(app).pipe(
      Layer.provide(platform),
      Layer.provide(tracerDisabledForProbes),
      Layer.merge(Layer.effectDiscard(banner))
    ),
    observability
  );
