import { Schema } from "effect";

export const Check = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["pass", "fail"]),
}).annotate({
  description: "One condition the readiness probe evaluates",
  identifier: "Check",
});

interface Check extends Schema.Schema.Type<typeof Check> {}

const checksField = { checks: Schema.Array(Check) };

export const HealthReport = Schema.Struct({
  status: Schema.Literals(["ok", "unhealthy"]),
  ...checksField,
}).annotate({
  description: "The status of the service and the checks behind it",
  identifier: "HealthReport",
});

export interface HealthReport extends Schema.Schema.Type<typeof HealthReport> {}

export class Unhealthy extends Schema.TaggedError<Unhealthy>()(
  "Unhealthy",
  { status: Schema.Literal("unhealthy"), ...checksField },
  {
    description: "The service is not ready to serve traffic",
    identifier: "Unhealthy",
    httpApiStatus: 503,
  }
) {}
