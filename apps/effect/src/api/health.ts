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
 * `PREFIX` and the three segments are the one statement of the paths. The group
 * and the exports below both read them, so `quietProbes` and the router cannot
 * drift.
 */
export const PREFIX = "/health";
const STARTUP = "/startup";
const LIVE = "/live";
const READY = "/ready";

export const STARTUP_PATH = `${PREFIX}${STARTUP}`;
export const LIVE_PATH = `${PREFIX}${LIVE}`;
export const READY_PATH = `${PREFIX}${READY}`;

export class HealthApiGroup extends HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("startup", STARTUP, {
      success: HealthReport,
    })
  )
  .add(
    HttpApiEndpoint.get("live", LIVE, {
      success: HealthReport,
    })
  )
  .add(
    HttpApiEndpoint.get("ready", READY, {
      success: HealthReport,
      error: Unhealthy,
    })
  )
  .prefix(PREFIX) {}
