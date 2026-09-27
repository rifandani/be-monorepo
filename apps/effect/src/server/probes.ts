import { Effect, Layer } from "effect";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
} from "effect/unstable/http";

import { PROBES } from "#api/health.ts";

/**
 * Which urls are probes, and which of them are traced — both read off `PROBES`
 * rather than restated here.
 *
 * Neither set is a policy this module owns. Whether a probe's span says
 * anything is a fact about what that probe does, so it is declared beside the
 * probe in `api/health.ts` and explained under **Probe Silence** in
 * `CONTEXT.md`. This module only applies it. A set written out here would be a
 * second, unchecked account of the same thing, and a fourth probe would need
 * an edit in both.
 */
// `Set<string>` and not the inferred set of the three literal paths: what is
// checked against these is a path derived from a request url, which is any
// string at all.
const probes = Object.values(PROBES);
const PROBE_PATHS: ReadonlySet<string> = new Set(
  probes.map((probe) => probe.path)
);
const UNTRACED_PROBE_PATHS: ReadonlySet<string> = new Set(
  probes.filter((probe) => !probe.traced).map((probe) => probe.path)
);

/**
 * The path part of a server request url.
 *
 * `HttpServerRequest.url` is a path with the query and fragment still attached,
 * so a bare `includes` over the paths above would let `/health/live?x=1` out of
 * every exclusion here. Effect's own `layerTracerDisabledForUrls` compares the
 * whole url for that reason and is not used below.
 *
 * Hand-written rather than reaching for a platform parser, for the reasons
 * `apps/effect/docs/adr/0004` records: this runs outside any matched route,
 * where the framework's parsed query does not exist.
 */
export const pathOf = (url: string): string => {
  const query = url.indexOf("?");
  const fragment = url.indexOf("#");

  if (query === -1) {
    return fragment === -1 ? url : url.slice(0, fragment);
  }

  return url.slice(0, fragment === -1 ? query : Math.min(query, fragment));
};

/** True when the request is a probe whose span would say nothing. */
export const isUntracedProbe = (url: string): boolean =>
  UNTRACED_PROBE_PATHS.has(pathOf(url));

/**
 * Makes a probe quiet: no per-request log line for any of the three, and no
 * spans at all for the two whose spans would say nothing.
 *
 * Two suppressions in one middleware because they are one policy, and because
 * neither is sufficient alone. `tracerDisabledForProbes` below stops the
 * *server* span, which `HttpMiddleware.tracer` opens outside the router — before
 * this middleware runs, so nothing in here can prevent it. But the handler's own
 * `Effect.fn("Health.live")` span is opened inside, and with the server span
 * gone it is exported as a *root* span rather than not at all. Verified against
 * a collector: a liveness poll with only the layer in place still sent one span
 * named `Health.live`. `withTracerEnabled(false)` is what makes it zero.
 *
 * A deployment polls each probe about once a second, so left alone the three
 * would be roughly a quarter of a million log lines a day, all of them saying
 * that the process is fine. They are counted instead — see `health.probe.result`
 * in `health.ts`. Nothing is lost: a counter answers "how many readiness
 * failures in the last hour" better than a quarter million events do.
 *
 * The log line this suppresses is Effect's own, applied by `HttpRouter.serve`
 * *outside* the router. `withLoggerDisabled` marks the request rather than
 * wrapping anything, so marking it from in here — before that middleware
 * reaches its check on the way out — is what makes this work at all.
 *
 * A failure is still logged: `error.ts` writes that line itself, from inside,
 * and this touches only the framework's one-per-response line.
 *
 * The three wrapped effects are built once, outside the returned effect: a
 * global middleware function receives `httpEffect` at layer build, and neither
 * wrapper reads the request when it is applied — `withLoggerDisabled` marks the
 * fiber when it runs. So the per-request work is one path derivation and a
 * choice between three values that already exist.
 */
export const quietProbes = HttpRouter.middleware(
  (httpEffect) => {
    const quiet = HttpMiddleware.withLoggerDisabled(httpEffect);
    const quietAndUntraced = Effect.withTracerEnabled(quiet, false);

    return HttpServerRequest.HttpServerRequest.pipe(
      Effect.flatMap((request) => {
        const path = pathOf(request.url);

        if (UNTRACED_PROBE_PATHS.has(path)) {
          return quietAndUntraced;
        }

        return PROBE_PATHS.has(path) ? quiet : httpEffect;
      })
    );
  },
  { global: true }
);

/**
 * Drops the server span for the probes that would not fill one.
 *
 * Head filtering, not sampling: the span is never created, so it costs nothing
 * to make and nothing to send. That is strictly cheaper than a sampler, which
 * has to build a span before deciding. It is also why this app runs no sampler
 * — with the probes gone there is nothing left worth sampling.
 *
 * This covers the server span only. The spans a handler opens for itself are
 * suppressed by `quietProbes` above; both are needed. See the note there.
 *
 * Provided to the server layer by the entrypoints rather than merged into `app`:
 * the tracer that reads this reference is applied by the platform's serve path,
 * outside the router, so what it does is a property of how the app is served and
 * not of the app.
 */
export const tracerDisabledForProbes: Layer.Layer<never> = Layer.succeed(
  HttpMiddleware.TracerDisabledWhen
)((request) => isUntracedProbe(request.url));
