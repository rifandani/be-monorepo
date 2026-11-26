import { RuleTester } from "oxlint/plugins-dev";

import {
  noManualEffectRuntimeInTests as rule,
  supplyServicesThroughLayers,
} from "./effect-tests.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const inTest = (code: string) => ({ code, filename: "src/user.test.ts" });

const reported = (code: string) => ({
  ...inTest(code),
  errors: [{ messageId: "manualRunner" }],
});

tester.run("no-manual-effect-runtime-in-tests", rule, {
  valid: [
    inTest('it.effect("should read", () => Effect.succeed(1));'),
    inTest("const program = Effect.map(Effect.succeed(1), String);"),
    inTest("runtime.runSync(program);"),
    inTest("Other.runSync(program);"),
    { code: "Effect.runSync(program);", filename: "src/main.ts" },
    { code: "Effect.runPromise(program);", filename: "src/user.ts" },
  ],
  invalid: [
    reported("Effect.runSync(program);"),
    reported("await Effect.runPromise(program);"),
    reported("Effect.runFork(program);"),
    reported("Effect.runPromiseExit(program);"),
    reported("ManagedRuntime.make(layer);"),
    {
      code: "Effect.runSync(program);",
      filename: "src/user.spec.tsx",
      errors: [{ messageId: "manualRunner" }],
    },
  ],
});

const vitest = 'import { it, vi } from "@effect/vitest";';
const effect = 'import { Context, Effect, Layer } from "effect";';
const msw = 'import { http, HttpResponse } from "msw";';

const supplied = (code: string, messageId: string) => ({
  code,
  filename: "apps/effect/tests/user.test.ts",
  errors: [{ messageId }],
});

const supplyValid = (code: string) => ({
  code,
  filename: "apps/effect/tests/user.test.ts",
});

tester.run("supply-services-through-layers", supplyServicesThroughLayers, {
  valid: [
    supplyValid(
      `${vitest} ${effect} const users = Layer.succeed(Users)(Users.of({ find: () => Effect.succeed(user) }));`
    ),
    supplyValid(
      `${vitest} ${effect} Effect.provideService(read, RequestId, "abc");`
    ),
    supplyValid(
      `${vitest} const log = vi.spyOn(console, "log"); run(); expect(log).toHaveBeenCalled();`
    ),
    supplyValid(
      `${vitest} const onSave = vi.fn(); save(onSave); expect(onSave).toHaveBeenCalledOnce();`
    ),
    supplyValid(
      `${vitest} ${msw} server.use(http.get("https://api.test/users", vi.fn(() => HttpResponse.json([]))));`
    ),
    supplyValid(
      `${vitest} ${msw} const resolver = vi.fn(() => HttpResponse.json([])); server.use(http.post("https://api.test/users", resolver));`
    ),
    supplyValid(
      `${vitest} ${effect} ${msw} Layer.succeed(Users)(Users.of({ handlers: [http.get("https://api.test/users", vi.fn())] }));`
    ),
    supplyValid(
      `${effect} const vi = { fn: (f) => f, mock: () => 1 }; vi.mock("#app/db.ts"); Layer.succeed(Users)({ find: vi.fn(() => 1) });`
    ),
    supplyValid(
      `${vitest} import { Effect } from "effect"; Effect.map(program, vi.fn());`
    ),
    supplyValid(
      `${vitest} import { Layer } from "effect-extra"; Layer.succeed(Users)({ find: vi.fn() });`
    ),
    supplyValid(
      `import { vi } from "./clock.ts"; vi.mock("#app/db.ts"); vi.spyOn(Users, "find");`
    ),
    {
      code: `${vitest} vi.mock("#features/users/repository.ts");`,
      filename: "apps/effect/src/features/users/service.ts",
    },
  ],
  invalid: [
    supplied(
      `${vitest} vi.mock("#features/users/repository.ts");`,
      "moduleMock"
    ),
    supplied(
      `${vitest} vi.mock("#features/users/repository.ts", () => ({ find: () => user }));`,
      "moduleMock"
    ),
    supplied(
      `${vitest} vi.doMock("#features/users/repository.ts");`,
      "moduleMock"
    ),
    supplied(
      `import { vi } from "vitest"; vi.mock("#features/users/repository.ts");`,
      "moduleMock"
    ),
    supplied(
      `import * as V from "@effect/vitest"; V.vi.mock("#app/db.ts");`,
      "moduleMock"
    ),
    supplied(`${vitest} vi.spyOn(users, "find");`, "spy"),
    supplied(
      `${vitest} vi.spyOn(Users.prototype, "find").mockReturnValue(user);`,
      "spy"
    ),
    supplied(`${vitest} vi.spyOn(globalThis, "fetch");`, "spy"),
    supplied(
      `${vitest} ${effect} Layer.succeed(Users)({ find: vi.fn() });`,
      "serviceFn"
    ),
    supplied(
      `${vitest} ${effect} Layer.succeed(Users)(Users.of({ find: vi.fn(() => Effect.succeed(user)) }));`,
      "serviceFn"
    ),
    supplied(`${vitest} ${effect} Users.of({ find: vi.fn() });`, "serviceFn"),
    supplied(
      `${vitest} import { Users } from "#features/users/service.ts"; Users.of({ find: vi.fn() });`,
      "serviceFn"
    ),
    supplied(
      `${vitest} ${effect} Effect.provideService(program, Users, { find: vi.fn() });`,
      "serviceFn"
    ),
    supplied(
      `${vitest} ${effect} Context.make(Users, { find: vi.fn() });`,
      "serviceFn"
    ),
    supplied(
      `${vitest} import * as Layer from "effect/Layer"; Layer.sync(Users, () => ({ find: vi.fn() }));`,
      "serviceFn"
    ),
    {
      code: `${vitest} vi.mock("#app/db.ts");`,
      filename: "apps/effect/src/features/users/service.test.ts",
      errors: [{ messageId: "moduleMock" }],
    },
  ],
});
