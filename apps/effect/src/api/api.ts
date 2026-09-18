import { HttpApi, OpenApi } from "effect/unstable/httpapi";

import { SERVICE_NAME, SERVICE_VERSION } from "#metadata.ts";

import { HealthApiGroup } from "./health.ts";

/**
 * The API description: every group, plus the OpenAPI metadata.
 *
 * The title and version come from `package.json` rather than from the
 * environment on purpose: annotations are plain values resolved when this
 * module loads, so reading them from a `Config` would force the definition to
 * become an `Effect` and stop being shareable with a client.
 */
export class Api extends HttpApi.make("effect-api")
  .add(HealthApiGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: SERVICE_NAME,
      version: SERVICE_VERSION,
      description: "Effect v4 HTTP API template",
    })
  ) {}
