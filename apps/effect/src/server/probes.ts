import { Effect, Layer } from "effect";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
} from "effect/unstable/http";

/**
 * The paths the three probes answer on.
 *
 * Stated here rather than derived from the api description, because the two
 * consumers below are both outside `HttpApiBuilder` and see a raw url, not a
 * matched route. `tests/app.test.ts` asserts each path against the mounted
 * group, which is what keeps this list and `api/health.ts` in step.
 */
export const STARTUP_PATH = "/health/startup";
export const LIVE_PATH = "/health/live";
export const READY_PATH = "/health/ready";

const PROBE_PATHS = new Set([STARTUP_PATH, LIVE_PATH, READY_PATH]);

/**
 * The probes that are not traced.
 *
 * The readiness probe is missing from this set on purpose: it is the only one
 * of the three that does work — it runs the readiness checks — so it is the
 * only one whose span would describe anything. The other two answer for the
 * process that is answering, which a span cannot add to.
 */
const UNTRACED_PROBE_PATHS = new Set([STARTUP_PATH, LIVE_PATH]);

/**
 * The path part of a server request url.
 *
 * `HttpServerRequest.url` is a path with the query and fragment still attached,
 * so a bare `includes` over the paths above would let `/health/live?x=1` out of
 * every exclusion here. Effect's own `layerTracerDisabledForUrls` compares the
 * whole url for that reason and is not used below.
 */
export const pathOf = (url: string): string => {
  const query = url.indexOf("?");
  const fragment = url.indexOf("#");

  if (query === -1) {
    return fragment === -1 ? url : url.slice(0, fragment);
  }

  return url.slice(0, fragment === -1 ? query : Math.min(query, fragment));
};

/** True when the request is one of the three probes. */
export const isProbe = (url: string): boolean => PROBE_PATHS.has(pathOf(url));

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
 * in `metrics.ts`. Nothing is lost: a counter answers "how many readiness
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
