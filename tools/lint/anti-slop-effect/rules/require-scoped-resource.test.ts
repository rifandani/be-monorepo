import { RuleTester } from "oxlint/plugins-dev";

import { requireScopedResourceRule } from "./require-scoped-resource.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const imports = `
	import * as Context from "effect/Context";
	import * as Effect from "effect/Effect";
	import * as Layer from "effect/Layer";
`;

const unscoped = (resource: string) => ({
  messageId: "unscoped",
  data: { resource },
});

const source = "/repo/apps/effect/src/features/users/database.ts";

tester.run(
  "anti-slop-effect/require-scoped-resource",
  requireScopedResourceRule,
  {
    valid: [
      {
        filename: source,
        code: `${imports}
			export class Database extends Context.Service<Database, Pool>()("@app/Database") {
				static readonly layer = Layer.effect(
					Database,
					Effect.acquireRelease(
						Effect.sync(() => new Pool({ connectionString })),
						(pool) => Effect.promise(() => pool.end())
					)
				);
			}`,
      },
      {
        filename: source,
        code: `${imports}
			export const query = Effect.acquireUseRelease(
				Effect.sync(() => postgres(url)),
				(sql) => Effect.promise(() => sql\`select 1\`),
				(sql) => Effect.promise(() => sql.end())
			);
			export const disposable = Effect.acquireDisposable(Effect.sync(() => createClient(url)));`,
      },
      {
        filename: source,
        code: `${imports}
			export const layer = Layer.effect(
				Database,
				Effect.gen(function* () {
					const client = drizzle(url);
					yield* Effect.addFinalizer(() => Effect.promise(() => client.$client.end()));
					return client;
				})
			);`,
      },
      {
        filename: source,
        code: `${imports}
			export const make = Effect.gen(function* () {
				const timer = setInterval(flush, 1000);
				yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(timer)));
			});
			export const start = Effect.fn("Flusher.start")(function* () {
				const server = yield* Effect.sync(() => app.listen(3000));
				yield* Effect.addFinalizer(() => Effect.sync(() => server.close()));
			});`,
      },
      {
        filename: source,
        code: `${imports}
			export const delay = Effect.callback<void>((resume) => {
				const timer = setTimeout(() => resume(Effect.void), 100);
				return Effect.sync(() => clearTimeout(timer));
			});`,
      },
      {
        filename: "/repo/apps/effect/src/features/users/service.test.ts",
        code: `
			const timer = setTimeout(done, 100);`,
      },
      {
        filename: "/repo/apps/effect/tests/helpers.ts",
        code: `
			export const wait = () => new Promise((resolve) => setTimeout(resolve, 10));`,
      },
      {
        filename: source,
        code: `
			const pool = new Pool();
			const server = app.listen(3000);`,
        options: [{ resources: ["createClient"] }],
      },
      {
        filename: "/repo/apps/effect/fixtures/clock.ts",
        code: `
			export const tick = setTimeout(done, 100);`,
        options: [{ testFiles: ["apps/*/fixtures/**"] }],
      },
      {
        filename: source,
        code: `
			const timer = window.setTimeout(done, 100);
			const id = pools.listen;
			const view = new PoolView();`,
      },
    ],
    invalid: [
      {
        filename: source,
        code: `
			export const pool = new Pool({ connectionString });
			export const sql = postgres(url);
			export const db = drizzle(sql);
			export const redis = createClient({ url });
			export const server = app.listen(3000);`,
        errors: [
          unscoped("new Pool"),
          unscoped("postgres"),
          unscoped("drizzle"),
          unscoped("createClient"),
          unscoped(".listen"),
        ],
      },
      {
        filename: source,
        code: `${imports}
			export const layer = Layer.effect(
				Database,
				Effect.sync(() => new pg.Pool({ connectionString }))
			);
			export const tick = Effect.sync(() => globalThis.setInterval(flush, 1000));
			export const delay = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));`,
        errors: [
          unscoped("new Pool"),
          unscoped("setInterval"),
          unscoped("setTimeout"),
        ],
      },
      {
        filename: source,
        code: `${imports}
			export const leaked = Effect.acquireRelease(
				Effect.sync(() => connection),
				() => Effect.sync(() => setTimeout(close, 10))
			);
			export const noCleanup = Effect.callback<void>((resume) => {
				setTimeout(() => resume(Effect.void), 100);
			});`,
        errors: [unscoped("setTimeout"), unscoped("setTimeout")],
      },
      {
        filename: source,
        code: `${imports}
			export const expressionBody = Effect.callback<void>((resume) =>
				setTimeout(() => resume(Effect.void), 100)
			);
			export const make = Effect.gen(function* () {
				yield* Effect.addFinalizer(() => Effect.log("stopped"));
				return { start: () => setInterval(flush, 1000) };
			});
			export const nested = Effect.gen(function* () {
				const pool = new Pool();
				yield* Effect.gen(function* () {
					yield* Effect.addFinalizer(() => Effect.log("inner"));
				});
			});`,
        errors: [
          unscoped("setTimeout"),
          unscoped("setInterval"),
          unscoped("new Pool"),
        ],
      },
      {
        filename: "/repo/apps/effect/src/features/users/service.test.ts",
        code: `
			const pool = new Pool();`,
        errors: [unscoped("new Pool")],
      },
      {
        filename: source,
        code: `
			const queue = new Queue();
			const timer = setTimeout(done, 100);`,
        options: [{ resources: ["new Queue"], sourceResources: [] }],
        errors: [unscoped("new Queue")],
      },
    ],
  }
);
