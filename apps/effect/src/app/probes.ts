import { PROBES } from "#features/health/api.ts";
import { makeProbePolicy } from "#server/probes.ts";

export const {
  isProbePath,
  isUntracedProbe,
  quietProbes,
  tracerDisabledForProbes,
} = makeProbePolicy(Object.values(PROBES));
