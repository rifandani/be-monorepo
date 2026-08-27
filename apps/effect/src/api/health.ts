import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { HealthReport, Unhealthy } from "#domain/health.ts";

/**
 * The `health` group: three probes, one prefix, no handler and no service.
 *
 * Three endpoints and not one, because the three answers mean different things
 * to whoever polls them — a startup probe suspends the liveness clock, a
 * liveness failure restarts the process, and a readiness failure only takes it
 * out of the pool. `CONTEXT.md` defines each. A single `/health` covering all
 * three would answer "whichever of them you assumed", which is the ambiguity
 * the split exists to remove, so there deliberately is no bare `/health`.
 *
 * `Unhealthy` is declared only on `ready`. The other two report on the process
 * that is answering, so a failure they could report is a failure that would
 * stop them answering at all.
 *
 * `.prefix` rather than three literal `/health/...` paths: the prefix is a
 * property of the group, and stating it once is what keeps the three from
 * drifting apart.
 */
export class HealthApiGroup extends HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("startup", "/startup", {
      success: HealthReport,
    })
  )
  .add(
    HttpApiEndpoint.get("live", "/live", {
      success: HealthReport,
    })
  )
  .add(
    HttpApiEndpoint.get("ready", "/ready", {
      success: HealthReport,
      error: Unhealthy,
    })
  )
  .prefix("/health") {}
