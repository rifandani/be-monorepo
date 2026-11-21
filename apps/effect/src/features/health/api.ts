import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { HealthReport, Unhealthy } from "./schema.ts";

export const PREFIX = "/health";

interface Probe<Segment extends `/${string}` = `/${string}`> {
  readonly segment: Segment;
  readonly path: `${typeof PREFIX}${Segment}`;
  readonly traced: boolean;
}

const probe = <const Segment extends `/${string}`>(
  segment: Segment,
  traced: boolean
): Probe<Segment> => ({
  path: `${PREFIX}${segment}`,
  segment,
  traced,
});

export const PROBES = {
  startup: probe("/startup", false),
  live: probe("/live", false),
  ready: probe("/ready", true),
} as const;

export const STARTUP_PATH = PROBES.startup.path;
export const LIVE_PATH = PROBES.live.path;
export const READY_PATH = PROBES.ready.path;

export class HealthApiGroup extends HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("startup", PROBES.startup.segment, {
      success: HealthReport,
    })
  )
  .add(
    HttpApiEndpoint.get("live", PROBES.live.segment, {
      success: HealthReport,
    })
  )
  .add(
    HttpApiEndpoint.get("ready", PROBES.ready.segment, {
      success: HealthReport,
      error: Unhealthy,
    })
  )
  .prefix(PREFIX) {}
