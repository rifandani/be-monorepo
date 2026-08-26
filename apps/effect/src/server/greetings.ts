import { Context, Effect, Layer } from "effect";

import { Greeting } from "../domain/greeting.js";

/**
 * What the app does, apart from how it is reached.
 *
 * The handler in `server/greetings/http.ts` only decodes, calls, and encodes;
 * the rule — such as it is for a greeting — is here, where a test can call it
 * without a request and a second transport could reuse it.
 */
export class Greetings extends Context.Service<
  Greetings,
  {
    readonly hello: () => Effect.Effect<Greeting>;
  }
>()("@workspace/effect/Greetings") {
  /**
   * `Layer.sync` and not `Layer.effect`, because there is nothing to acquire:
   * the service holds no connection, client or handle. Give it a dependency
   * later and this becomes `Layer.effect(Greetings, Effect.gen(...))`.
   */
  static readonly layer: Layer.Layer<Greetings> = Layer.sync(Greetings, () =>
    Greetings.of({
      // `Effect.fn` names the span, so the operation appears in a trace under
      // `Greetings.hello` and not inside the request span alone.
      hello: Effect.fn("Greetings.hello")(() =>
        Effect.succeed(Greeting.make({ message: "Hello World" }))
      ),
    })
  );
}
