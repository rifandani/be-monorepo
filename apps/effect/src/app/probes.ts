import { PROBES } from "#features/health/api.ts";
import { makeProbePolicy } from "#server/probes.ts";

/** Keep the feature's probe definitions as the single source of policy. */
export const { isUntracedProbe, quietProbes, tracerDisabledForProbes } =
  makeProbePolicy(Object.values(PROBES));
