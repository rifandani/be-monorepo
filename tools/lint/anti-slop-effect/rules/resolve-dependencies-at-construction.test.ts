import { RuleTester } from "oxlint/plugins-dev";

import { resolveDependenciesAtConstructionRule } from "./resolve-dependencies-at-construction.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const imports = `
	import { Context, Effect, Layer } from "effect";
	import { Database } from "../database/service.ts";
	import { Mailer } from "@workspace/mailer";
`;

const lateDependency = (dependency: string, variable: string) => ({
  messageId: "lateDependency",
  data: { dependency, variable },
});

tester.run(
  "anti-slop-effect/resolve-dependencies-at-construction",
  resolveDependenciesAtConstructionRule,
  {
    valid: [
      `${imports}
		export class Users extends Context.Service<Users, UsersShape>()("@app/Users", {
			make: Effect.gen(function* () {
				const database = yield* Database;
				const mailer = yield* Mailer;
				return {
					find: Effect.fn("Users.find")(function* (id: string) {
						return yield* database.find(id);
					}),
					invite: (email: string) => mailer.send(email),
				};
			}),
		}) {
			static readonly layer = Layer.effect(this, this.make);
		}`,
      `${imports}
		import { CurrentLogLevel } from "effect/References";
		import { UserNotFound } from "./errors.ts";
		const Defaults = Effect.succeed({ limit: 10 });
		export class Users extends Context.Service<Users, UsersShape>()("@app/Users", {
			make: Effect.gen(function* () {
				return {
					find: Effect.fn("Users.find")(function* (id: string) {
						const level = yield* CurrentLogLevel;
						const defaults = yield* Defaults;
						return yield* new UserNotFound({ id, level, defaults });
					}),
				};
			}),
		}) {}`,
      `${imports}
		export class Users extends Context.Service<Users, UsersShape>()("@app/Users", {
			make: Effect.gen(function* () {
				const pool = yield* Effect.acquireRelease(
					Effect.gen(function* () { return (yield* Database).pool(); }),
					(pool) => pool.close
				);
				yield* Effect.forkScoped(Effect.gen(function* () { yield* Mailer; }));
				return { pool: yield* Database, find: (id: string) => pool.find(id) };
			}),
		}) {}`,
      `${imports}
		export class Health extends Context.Service<Health, HealthShape>()("@app/Health") {
			static readonly make = (checks: readonly Check[]): Health["Service"] =>
				Health.of({
					ready: Effect.fn("Health.ready")(function* ready() {
						return yield* Effect.forEach(checks, runCheck);
					}),
				});
			static readonly layer = Layer.sync(Health, () => Health.make([]));
		}`,
      `${imports}
		export const handler = Effect.gen(function* () {
			const users = yield* Users;
			return yield* Effect.forEach(ids, (id) => Effect.gen(function* () {
				return yield* (yield* Database).find(id);
			}));
		});`,
      {
        filename: "users.test.ts",
        code: `${imports}
			export const UsersTest = Layer.effect(Users, Effect.gen(function* () {
				return { find: () => Effect.gen(function* () { return yield* Database; }) };
			}));`,
      },
    ],
    invalid: [
      {
        code: `${imports}
			export class Users extends Context.Service<Users, UsersShape>()("@app/Users", {
				make: Effect.gen(function* () {
					return {
						find: Effect.fn("Users.find")(function* (id: string) {
							const database = yield* Database;
							return yield* database.find(id);
						}),
					};
				}),
			}) {}`,
        errors: [lateDependency("Database", "database")],
      },
      {
        code: `${imports}
			export const UsersLive = Layer.effect(Users, Effect.gen(function* () {
				return Users.of({
					invite: (email: string) => Effect.gen(function* () {
						const mailer = yield* Mailer;
						yield* mailer.send(email);
					}),
				});
			}));`,
        errors: [lateDependency("Mailer", "mailer")],
      },
      {
        code: `${imports}
			const make = Effect.gen(function* () {
				return { invite: Effect.fn("Users.invite")(function* () { yield* Mailer; }) };
			}).pipe(Effect.withSpan("Users.make"));
			export const UsersLive = Layer.effect(Users)(make);`,
        errors: [lateDependency("Mailer", "mailer")],
      },
      {
        code: `${imports}
			const make = Effect.gen(function* () {
				return { invite: Effect.fn("Users.invite")(function* () { yield* Mailer; }) };
			});
			export const UsersLive = Layer.scoped(Users, make);
			export const UsersAgain = Layer.effect(Users, make);`,
        errors: [lateDependency("Mailer", "mailer")],
      },
      {
        code: `${imports}
			export class Users extends Context.Service<Users, UsersShape>()("@app/Users") {
				static readonly make = (options: Options): Users["Service"] =>
					Users.of({
						find: Effect.fn("Users.find")(function* (id: string) {
							return yield* (yield* Database).find(id);
						}),
					});
				static readonly layer = Layer.sync(Users, () => Users.make(defaults));
			}`,
        errors: [lateDependency("Database", "database")],
      },
      {
        code: `${imports}
			export class Users extends Context.Service<Users, UsersShape>()("@app/Users") {
				static readonly make = () => {
					const find = Effect.fn("Users.find")(function* (id: string) {
						return yield* (yield* Database).find(id);
					});
					const operations = { find };
					return Users.of(operations);
				};
			}`,
        errors: [lateDependency("Database", "database")],
      },
      {
        code: `${imports}
			class Clock extends Context.Service<Clock, ClockShape>()("@app/Clock") {}
			export class Sessions extends Effect.Service<Sessions>()("@app/Sessions", {
				effect: Effect.gen(function* () {
					return { start: () => Effect.gen(function* () { return (yield* Clock).now(); }) };
				}),
			}) {}`,
        errors: [lateDependency("Clock", "clock")],
      },
    ],
  }
);
