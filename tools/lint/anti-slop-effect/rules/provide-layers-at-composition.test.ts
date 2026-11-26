import { RuleTester } from "oxlint/plugins-dev";

import { provideLayersAtCompositionRule } from "./provide-layers-at-composition.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const imports = `
	import * as Effect from "effect/Effect";
	import * as Layer from "effect/Layer";
`;

const outsideComposition = (operator: string) => ({
  messageId: "outsideComposition",
  data: { operator },
});

const mergeDiscarded = { messageId: "mergeDiscarded" };

tester.run(
  "anti-slop-effect/provide-layers-at-composition",
  provideLayersAtCompositionRule,
  {
    valid: [
      {
        filename: "/repo/apps/effect/src/app/main.ts",
        code: `${imports}
			export const main = Layer.provide(
				HttpRouter.serve(app).pipe(Layer.provide(platform), Layer.merge(Layer.effectDiscard(banner))),
				observability
			);
			export const http = Layer.mergeAll(health, Layer.provideMerge(collectors, base));
			export const run = program.pipe(Effect.provide(main));`,
      },
      {
        filename: "/repo/apps/effect/src/features/health/handlers.test.ts",
        code: `${imports}
			const served = app.pipe(Layer.provide(configProvider), Layer.provideMerge(NodeHttpServer.layerTest));
			const result = Effect.runPromise(program.pipe(Effect.provide(served)));`,
      },
      {
        filename: "/repo/apps/effect/src/features/health/service.ts",
        code: `${imports}
			export class Health extends Context.Service<Health, HealthShape>()("@app/Health") {
				static readonly layer = Layer.effect(Health, make);
			}
			export const check = Effect.provideService(program, Clock, clock);
			export const empty = Layer.empty;`,
      },
      {
        filename: "/repo/apps/effect/src/server/platform.ts",
        code: `
			import { Layer } from "./local-layer.ts";
			export const platform = Layer.provide(a, b);`,
      },
      {
        filename: "/repo/packages/core/src/wiring/live.ts",
        options: [{ allow: ["packages/*/src/wiring/**"] }],
        code: `${imports}
			export const live = Layer.mergeAll(a, b).pipe(Layer.provide(c));`,
      },
      {
        filename: "C:\\repo\\apps\\effect\\tests\\layers.ts",
        code: `${imports}
			export const served = app.pipe(Layer.provide(configProvider));`,
      },
      {
        filename: "/repo/apps/effect/src/app/main.ts",
        code: `${imports}
			export const used = app.pipe(Layer.provideMerge(collectors));
			export const live = app.pipe(Layer.provideMerge(observability));
			export const main = Layer.launch(live);
			const shared = app.pipe(Layer.provideMerge(observability));
			export const both = Layer.mergeAll(Layer.launch(shared), probes.pipe(Layer.provide(shared)));
			export const unknownStep = Layer.launch(app.pipe(Layer.provideMerge(observability), Layer.flatMap(build)));`,
      },
    ],
    invalid: [
      {
        filename: "/repo/apps/effect/src/features/users/service.ts",
        code: `${imports}
			export const find = (id: string) => repository.find(id).pipe(Effect.provide(DatabaseLive));`,
        errors: [outsideComposition("Effect.provide")],
      },
      {
        filename: "/repo/apps/effect/src/server/platform.ts",
        code: `
			import { Layer as L } from "effect";
			export const platform = L.mergeAll(a, b).pipe(
				L.provide(c),
				L.provideMerge(d),
				L.merge(e)
			);`,
        errors: [
          outsideComposition("Layer.mergeAll"),
          outsideComposition("Layer.provide"),
          outsideComposition("Layer.provideMerge"),
          outsideComposition("Layer.merge"),
        ],
      },
      {
        filename: "/repo/apps/effect/src/app/main.ts",
        options: [{ allow: ["apps/*/src/composition/**"] }],
        code: `${imports}
			export const main = Layer.provide(app, platform);`,
        errors: [outsideComposition("Layer.provide")],
      },
      {
        filename: "/repo/apps/effect/src/app/main.ts",
        code: `${imports}
			const live = app.pipe(Layer.provide(platform), Layer.provideMerge(observability));
			export const direct = Layer.launch(Layer.provideMerge(app, observability));
			export const indirect = Layer.launch(live);
			export const piped = app.pipe(Layer.provideMerge(observability), Layer.launch);
			export const thenProvided = Layer.launch(Layer.provideMerge(app, collectors).pipe(Layer.provide(platform)));
			export const inMerge = Layer.launch(Layer.mergeAll(probes, app.pipe(Layer.provideMerge(collectors), Layer.provide(platform))));`,
        errors: [
          mergeDiscarded,
          mergeDiscarded,
          mergeDiscarded,
          mergeDiscarded,
          mergeDiscarded,
        ],
      },
      {
        filename: "/repo/apps/effect/src/features/users/live.ts",
        code: `${imports}
			export const main = Layer.launch(app.pipe(Layer.provideMerge(platform)));`,
        errors: [mergeDiscarded, outsideComposition("Layer.provideMerge")],
      },
    ],
  }
);
