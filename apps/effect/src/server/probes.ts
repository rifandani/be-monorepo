import { Effect, Layer } from "effect";
import { HttpMiddleware, HttpRouter, HttpServerRequest } from "effect/http";

/** Remove the query and fragment from the server request URL. */
export const pathOf = (url: string): string => {
  const query = url.indexOf("?");
  const fragment = url.indexOf("#");

  if (query === -1) {
    return fragment === -1 ? url : url.slice(0, fragment);
  }

  return url.slice(0, fragment === -1 ? query : Math.min(query, fragment));
};

interface ProbePolicyInput {
  readonly path: string;
  readonly traced: boolean;
}

/**
 * Apply the probe policy supplied by app composition. Server infrastructure
 * does not own the health feature's paths or tracing decisions.
 *
 * Both mechanisms are required: TracerDisabledWhen stops the server span,
 * and withTracerEnabled(false) stops spans opened by the handler. The request
 * logger is disabled for every probe. See docs/observability.md.
 */
export const makeProbePolicy = (probes: readonly ProbePolicyInput[]) => {
  const probePaths: ReadonlySet<string> = new Set(
    probes.map((probe) => probe.path)
  );

  const untracedProbePaths: ReadonlySet<string> = new Set(
    probes.flatMap((probe) => (probe.traced ? [] : [probe.path]))
  );

  const isUntracedProbe = (url: string): boolean =>
    untracedProbePaths.has(pathOf(url));

  const quietProbes = HttpRouter.middleware(
    (httpEffect) => {
      const quiet = HttpMiddleware.withLoggerDisabled(httpEffect);
      const quietAndUntraced = Effect.withTracerEnabled(quiet, false);

      return HttpServerRequest.HttpServerRequest.pipe(
        Effect.flatMap((request) => {
          const path = pathOf(request.url);

          if (untracedProbePaths.has(path)) {
            return quietAndUntraced;
          }

          return probePaths.has(path) ? quiet : httpEffect;
        })
      );
    },
    { global: true }
  );

  // The platform tracer reads this outside the router. App composition must
  // provide it to the server in addition to installing quietProbes.
  const tracerDisabledForProbes: Layer.Layer<never> = Layer.succeed(
    HttpMiddleware.TracerDisabledWhen
  )((request) => isUntracedProbe(request.url));

  return { isUntracedProbe, quietProbes, tracerDisabledForProbes };
};
