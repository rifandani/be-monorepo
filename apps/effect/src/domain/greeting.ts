import { Schema } from "effect";

// A schema and its decoded type share one name on purpose: `Greeting` is the
// value at a call site and the type in a signature, which is the Effect
// convention. These three rules each read that pair as a mistake.
// oxlint-disable no-redeclare
// oxlint-disable typescript/no-empty-interface
// oxlint-disable typescript/no-empty-object-type

/**
 * The greeting the service returns.
 *
 * A struct rather than a bare `Schema.String` so the endpoint has somewhere to
 * grow: adding a field to an object is backwards compatible, replacing a
 * top-level JSON string is not.
 *
 * It lives in `domain/` because both sides use it: `api/` puts it in the
 * endpoint description and the OpenAPI document, `server/` returns it from the
 * service. `identifier` is what names the schema in that document.
 */
export const Greeting = Schema.Struct({
  message: Schema.String,
}).annotate({
  description: "A greeting returned by the service",
  identifier: "Greeting",
});

export interface Greeting extends Schema.Schema.Type<typeof Greeting> {}
