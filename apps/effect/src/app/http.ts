import { Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";

import { Health } from "#features/health/service.ts";

import { Api } from "./api.ts";
import type { Overrides } from "./chain.ts";
import { chain } from "./chain.ts";
import { healthHandlers } from "./health.ts";

export const appWith = (overrides: Overrides) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(Api, { openapiPath: "/openapi" }).pipe(
      Layer.provide(healthHandlers.pipe(Layer.provide(Health.layer)))
    ),
    HttpApiScalar.layer(Api, { path: "/openapi/docs" }),
    chain(overrides)
  );

export const app = appWith({});
