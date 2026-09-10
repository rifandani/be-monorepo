import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { HealthReport, Unhealthy } from "#domain/health.ts";

export const PREFIX = "/health";

/**
 * One Probe: where it is served, and whether it is traced.
 *
 * `CONTEXT.md` defines the term. `PROBES` below is the one statement of a
 * Probe — the group builds its endpoint from `segment`, `server/probes.ts`
 * builds both of its exclusion sets from `path` and `traced`, and
 * `server/health.ts` keys the Probe Outcome counter on the id. Adding a fourth
 * probe is an entry there plus whatever the compiler then asks for.
 *
 * There is no `id` field: the key is the id. `server/health.ts` takes its
 * `probe` attribute as `keyof typeof PROBES`, so the two cannot disagree.
 *
 * There is no `logged` field either. No probe gets a per-request log line, so
 * the field would hold one value three times — that is `quietProbes`' policy,
 * not a property of a Probe. The day one probe wants its own line is the day
 * the field earns a place.
 */
interface Probe<Segment extends `/${string}` = `/${string}`> {
  /** The path under `PREFIX`, as the endpoint declares it. */
  readonly segment: Segment;
  /** Where the probe is actually served. Derived; never written twice. */
  readonly path: `${typeof PREFIX}${Segment}`;
  /** Whether the server span is kept. See **Probe Silence** in `CONTEXT.md`. */
  readonly traced: boolean;
}

/**
 * `Segment` is generic, and `const`, so each entry keeps its literal path.
 * `HttpApiEndpoint.get` takes `const Path extends PathInput` — a plain `string`
 * field would widen past that and stop compiling.
 */
const probe = <const Segment extends `/${string}`>(
  segment: Segment,
  traced: boolean
): Probe<Segment> => ({
  path: `${PREFIX}${segment}`,
  segment,
  traced,
});

/** The three Probes this app answers. */
export const PROBES = {
  // Answering at all is the signal, so there is nothing for a span to describe.
  startup: probe("/startup", false),
  // Unconditional, for the reason `server/health.ts` argues — a span over it
  // would record that the process answered, which the response already says.
  live: probe("/live", false),
  // Traced: it runs the Checks, so its span describes work.
  ready: probe("/ready", true),
} as const;

export const STARTUP_PATH = PROBES.startup.path;
export const LIVE_PATH = PROBES.live.path;
export const READY_PATH = PROBES.ready.path;

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
 * The three `.add` calls are written out rather than folded over `PROBES`, and
 * have to be: a fold collapses three endpoints into one union and takes `Api`'s
 * types with it — `ready` alone declares an error. So the endpoint id stays a
 * literal here. It is the record's key, and nothing but a test enforces that:
 * an entry with no `.add` compiles clean and simply is not served, which is
 * what the mount cases in `tests/app.test.ts` iterate `PROBES` to catch.
 */

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
