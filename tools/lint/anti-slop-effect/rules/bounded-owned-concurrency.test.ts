import { RuleTester } from "oxlint/plugins-dev";

import { boundedOwnedConcurrencyRule } from "./bounded-owned-concurrency.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const imports = `
	import * as Effect from "effect/Effect";
	import * as Stream from "effect/Stream";
`;

const unbounded = { messageId: "unbounded" };

const unowned = (call: string) => ({ messageId: "unowned", data: { call } });

const source = "/repo/apps/effect/src/features/users/service.ts";
const entryPoint = "/repo/apps/effect/src/app/main.ts";

tester.run(
  "anti-slop-effect/bounded-owned-concurrency",
  boundedOwnedConcurrencyRule,
  {
    valid: [
      {
        filename: source,
        code: `${imports}
			export const all = Effect.forEach(users, notify, { concurrency: 8 });
			export const tuple = Effect.all([a, b], { concurrency: 2 });
			export const mapped = stream.pipe(Stream.mapEffect(load, { concurrency: 4 }));
			export const inherited = Effect.all(tasks, { concurrency: "inherit" });
			export const sequential = Effect.forEach(users, notify);`,
      },
      {
        filename: source,
        code: `${imports}
			export const owned = Effect.gen(function* () {
				const child = yield* Effect.forkChild(work);
				const scoped = yield* Effect.forkScoped(work);
				const inScope = yield* Effect.forkIn(work, scope);
				return [child, scoped, inScope];
			});`,
      },
      {
        filename: entryPoint,
        code: `${imports}
			Effect.runFork(program);
			export const background = program.pipe(Effect.forkDetach);`,
      },
      {
        filename: "/repo/apps/effect/scripts/seed.ts",
        code: `${imports}
			Effect.runFork(program);`,
      },
      {
        filename: "/repo/apps/effect/src/server/timeout.test.ts",
        code: `${imports}
			const fiber = Effect.runFork(Effect.forkDetach(program));`,
      },
      {
        filename: "/repo/apps/effect/src/cli/main.ts",
        code: `${imports}
			Effect.runFork(program);`,
        options: [{ entryPoints: ["apps/*/src/cli/**"] }],
      },
      {
        filename: source,
        code: `
			const Effect = { forkDetach: () => undefined, runFork: () => undefined };
			Effect.forkDetach();
			Effect.runFork();
			const options = { concurrency: 4, mode: "unbounded" };`,
      },
      {
        filename: "/repo/apps/hono/src/routes/users.ts",
        code: `
			import pMap from "p-map";
			export const sent = pMap(users, notify, { concurrency: "unbounded" });`,
      },
    ],
    invalid: [
      {
        filename: source,
        code: `${imports}
			export const all = Effect.forEach(users, notify, { concurrency: "unbounded" });
			export const tuple = Effect.all([a, b], { concurrency: "unbounded" });
			export const mapped = stream.pipe(Stream.mapEffect(load, { concurrency: "unbounded" }));
			export const quoted = Effect.all(tasks, { "concurrency": "unbounded" });`,
        errors: [unbounded, unbounded, unbounded, unbounded],
      },
      {
        filename: "/repo/apps/effect/src/server/timeout.test.ts",
        code: `${imports}
			const results = Effect.all(tasks, { concurrency: "unbounded" });`,
        errors: [unbounded],
      },
      {
        filename: source,
        code: `${imports}
			export const send = Effect.gen(function* () {
				yield* Effect.forkDetach(audit);
				yield* audit.pipe(Effect.forkDaemon);
				Effect.runFork(audit);
				Effect.runForkWith(services)(audit);
			});`,
        errors: [
          unowned("Effect.forkDetach"),
          unowned("Effect.forkDaemon"),
          unowned("Effect.runFork"),
          unowned("Effect.runForkWith"),
        ],
      },
      {
        filename: "/repo/apps/hono/src/routes/users.ts",
        code: `
			import { Effect as E } from "effect";
			export const handler = () => E.runFork(program);`,
        errors: [unowned("Effect.runFork")],
      },
      {
        filename: entryPoint,
        code: `${imports}
			Effect.runFork(program);`,
        options: [{ entryPoints: ["apps/*/src/cli/**"] }],
        errors: [unowned("Effect.runFork")],
      },
    ],
  }
);
