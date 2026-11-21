import { Effect, Layer } from "effect";
import { HttpMiddleware, HttpRouter, HttpServerRequest } from "effect/http";

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

  const tracerDisabledForProbes: Layer.Layer<never> = Layer.succeed(
    HttpMiddleware.TracerDisabledWhen
  )((request) => isUntracedProbe(request.url));

  return { isUntracedProbe, quietProbes, tracerDisabledForProbes };
};
