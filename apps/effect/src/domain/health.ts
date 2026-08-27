import { Schema } from "effect";

// A schema and its decoded type share one name on purpose, which is the Effect
// convention. These three rules each read that pair as a mistake. See the same
// block in the module `greeting.ts` used to be.
// oxlint-disable no-redeclare
// oxlint-disable typescript/no-empty-interface
// oxlint-disable typescript/no-empty-object-type

/**
 * One named condition the readiness probe evaluates.
 *
 * Only the name and the outcome cross the wire. Why a check failed is a server
 * failure's own message — the module, the query or the upstream host that broke
 * — and `server/error.ts` argues at length that none of that is the client's
 * business. It goes to the log instead.
 */
export const Check = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["pass", "fail"]),
}).annotate({
  description: "One condition the readiness probe evaluates",
  identifier: "Check",
});

export interface Check extends Schema.Schema.Type<typeof Check> {}

/**
 * The checks a report lists, stated once because two schemas carry them: the
 * success body below and the `Unhealthy` error. That is the decision worth
 * protecting — which dependency broke is said in the body, not inferred from
 * the status code — and one declaration is what stops the two drifting apart.
 */
const checksField = { checks: Schema.Array(Check) };

/**
 * What a probe answers with.
 *
 * `checks` is empty for the startup and liveness probes, which have none by
 * definition, and that is not a placeholder for missing work: those two probes
 * answer for the process itself. See `CONTEXT.md` for the three probes and what
 * separates them.
 */
export const HealthReport = Schema.Struct({
  status: Schema.Literals(["ok", "unhealthy"]),
  ...checksField,
}).annotate({
  description: "The status of the service and the checks behind it",
  identifier: "HealthReport",
});

export interface HealthReport extends Schema.Schema.Type<typeof HealthReport> {}

/**
 * A readiness probe reporting that the service cannot serve traffic.
 *
 * `httpApiStatus` is what makes this a 503 rather than the 500 an undeclared
 * failure would become: a caller has to be able to tell "do not route to me"
 * from "I am broken", because the first is not a reason to restart the process.
 *
 * A failure and not a 200 with a bad status in the body, which would defeat
 * every probe consumer that reads only the status code.
 */
// `Schema.TaggedError` builds an error *class*; it is not a call that throws
// one, which is what this rule is looking for.
// oxlint-disable-next-line unicorn/throw-new-error
export class Unhealthy extends Schema.TaggedError<Unhealthy>()(
  "Unhealthy",
  // The same keys as a success report, so both halves of the contract decode
  // into one shape — but `status` is pinned to the only value an *error* can
  // truthfully carry. Sharing the report's wider `"ok" | "unhealthy"` would make
  // `new Unhealthy({ status: "ok" })` a constructible nonsense.
  { status: Schema.Literal("unhealthy"), ...checksField },
  {
    description: "The service is not ready to serve traffic",
    identifier: "Unhealthy",
    httpApiStatus: 503,
  }
) {}
