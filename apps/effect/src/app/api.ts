import { HttpApi, OpenApi } from "effect/http-api";

import { HealthApiGroup } from "#features/health/api.ts";
import { SERVICE_NAME, SERVICE_VERSION } from "#shared/metadata.ts";

export class Api extends HttpApi.make("effect-api")
  .add(HealthApiGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: SERVICE_NAME,
      version: SERVICE_VERSION,
      description: "Effect v4 HTTP API template",
    })
  ) {}
