import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { Greeting } from "../domain/greeting.js";

/**
 * The `greetings` group: which endpoints exist, and the schema of each request
 * and response. No handler, no service, no `Config`.
 *
 * A class rather than a `const` so the group has a name in every type error and
 * in the derived client, which is the shape the Effect documentation uses.
 */
export class GreetingsApiGroup extends HttpApiGroup.make("greetings").add(
  HttpApiEndpoint.get("hello", "/", {
    success: Greeting,
  })
) {}
