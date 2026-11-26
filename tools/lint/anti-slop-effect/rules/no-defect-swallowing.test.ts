import { RuleTester } from "oxlint/plugins-dev";

import { noDefectSwallowingRule } from "./no-defect-swallowing.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const imports = 'import { Effect } from "effect";';

const swallowed = (operator: string) => ({
  messageId: "swallowed",
  data: { operator: `Effect.${operator}` },
});

const boundary = "/repo/apps/effect/src/server/error.ts";

tester.run("anti-slop-effect/no-defect-swallowing", noDefectSwallowingRule, {
  valid: [
    `${imports}
      const a = load.pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));
      const b = load.pipe(Effect.catchTags({ NotFound: () => Effect.succeed(null) }));`,
    `${imports}
      const a = load.pipe(Effect.catch((error) => Effect.fail(new Failed({ cause: error }))));
      const b = load.pipe(Effect.catchCause((cause) => Effect.andThen(Effect.logError(cause), Effect.failCause(cause))));
      const c = load.pipe(Effect.catchDefect((defect) => Effect.die(defect)));
      const d = Effect.catchCause(load, (cause) => Effect.failCause(cause));`,
    `${imports}
      const a = load.pipe(Effect.catchCause((cause) => Effect.gen(function* () {
        yield* Effect.logError(cause);
        return yield* Effect.failCause(cause);
      })));
      const b = load.pipe(Effect.catch((error) => Effect.gen(function* () {
        return yield* new Failed({ cause: error });
      })));`,
    `${imports}
      const a = load.pipe(Effect.catch(recover));
      const b = load.pipe(Effect.catch((error) => Effect.as(Effect.fail(error), fallback)));`,
    `
      import * as Effect from "other-library";
      const a = load.pipe(Effect.ignore, Effect.catchCause(() => Effect.succeed(1)));`,
    {
      filename: boundary,
      options: [{ allow: ["apps/effect/src/server/error.ts"] }],
      code: `${imports}
        const respond = Effect.fn("respond")(function* (cause) { return response; });
        export const onError = (self) => Effect.catchCause(self, respond);
        const quiet = load.pipe(Effect.ignore);`,
    },
  ],
  invalid: [
    {
      code: `${imports}
        const a = load.pipe(Effect.catchCause(() => Effect.succeed(fallback)));
        const b = load.pipe(Effect.catchDefect(() => Effect.void));
        const c = load.pipe(Effect.catch((error) => Effect.as(Effect.logError(error), fallback)));
        const d = load.pipe(Effect.catchAll(() => Effect.sync(() => fallback)));`,
      errors: [
        swallowed("catchCause"),
        swallowed("catchDefect"),
        swallowed("catch"),
        swallowed("catchAll"),
      ],
    },
    {
      code: `${imports}
        const a = load.pipe(Effect.ignore);
        const b = Effect.ignore(load, { log: true });
        const c = load.pipe(Effect.ignoreCause({ log: true }));
        const d = load.pipe(Effect.orElseSucceed(() => fallback));`,
      errors: [
        swallowed("ignore"),
        swallowed("ignore"),
        swallowed("ignoreCause"),
        swallowed("orElseSucceed"),
      ],
    },
    {
      code: `${imports}
        const a = load.pipe(Effect.catchCause((cause) => Effect.gen(function* () {
          yield* Effect.logError(cause);
        })));
        const b = load.pipe(Effect.catch((error) => Effect.gen(function* () {
          yield* Effect.logError(error);
          return fallback;
        })));
        const c = load.pipe(Effect.catch((error) => Effect.logError(error).pipe(Effect.as(fallback))));
        const d = load.pipe(Effect.catch((error) => ready ? Effect.fail(error) : Effect.succeed(fallback)));
        const e = load.pipe(Effect.catchCause((cause) => Effect.logError("load failed", cause)));`,
      errors: [
        swallowed("catchCause"),
        swallowed("catch"),
        swallowed("catch"),
        swallowed("catch"),
        swallowed("catchCause"),
      ],
    },
    {
      code: `${imports}
        const respond = Effect.fn("respond")(function* (cause) { return response; });
        const recover = (cause) => Effect.succeed(fallback);
        const a = Effect.catchCause(load, respond);
        const b = load.pipe(Effect.catchCause(recover));`,
      errors: [swallowed("catchCause"), swallowed("catchCause")],
    },
    {
      filename: "/repo/apps/effect/src/features/health/service.ts",
      options: [{ allow: ["apps/effect/src/server/error.ts"] }],
      code: `${imports}
        const a = load.pipe(Effect.ignore);`,
      errors: [swallowed("ignore")],
    },
  ],
});
