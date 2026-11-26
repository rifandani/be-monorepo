import type { Layer as LayerType } from "effect";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";

import { observability } from "#server/observability.ts";
import { APP_TITLE, APP_URL, readAll } from "#shared/config.ts";

import { app } from "./http.ts";
import { tracerDisabledForProbes } from "./probes.ts";

const banner = Effect.gen(function* banner() {
  const { title, url } = yield* readAll({ title: APP_TITLE, url: APP_URL });

  yield* Effect.log(`${title} is reachable at ${url.toString()}`);
});

export const main = <A, E, R>(platform: LayerType.Layer<A, E, R>) =>
  Layer.provide(
    HttpRouter.serve(app).pipe(
      Layer.provide(platform),
      Layer.provide(tracerDisabledForProbes),
      Layer.merge(Layer.effectDiscard(banner))
    ),
    observability
  );
