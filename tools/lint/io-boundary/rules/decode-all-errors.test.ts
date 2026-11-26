import { RuleTester } from "oxlint/plugins-dev";

import { decodeAllErrors } from "./decode-all-errors.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const OPTIONS = {
  decodeFiles: ["apps/effect/src/shared/config.ts", "scripts/**"],
};

const schema = 'import { Schema } from "effect";';
const config = 'import { Config, Effect } from "effect";';
const shared =
  'import { Effect } from "effect"; import { APP_TITLE, APP_URL, PORT } from "#shared/config.ts";';

const inScript = (code: string) => ({
  code,
  filename: "scripts/security/sca-gate.ts",
  options: [OPTIONS],
});

const inApp = (code: string) => ({
  code,
  filename: "apps/effect/src/server/admission.ts",
  options: [OPTIONS],
});

const decodeReported = (code: string) => ({
  ...inScript(code),
  errors: [{ messageId: "firstErrorOnly" }],
});

const configReported = (code: string) => ({
  ...inApp(code),
  errors: [{ messageId: "sequentialConfig" }],
});

tester.run("io-boundary/decode-all-errors", decodeAllErrors, {
  valid: [
    inScript(
      `${schema} const parsed = Schema.decodeUnknownResult(Allowlist, { errors: "all" })(json);`
    ),
    inScript(
      `${schema} const parsed = Schema.decodeUnknownResult(Allowlist)(json, { errors: "all" });`
    ),
    inScript(
      `${schema} const ALL = { errors: "all" } as const; const parsed = Schema.decodeUnknownSync(Allowlist, ALL)(json);`
    ),
    inScript(
      `${schema} const decode = Schema.decodeUnknownOption(Payload, { errors: "all", onExcessProperty: "ignore" });`
    ),
    inScript(
      `${schema} const Trimmed = Schema.String.pipe(Schema.decodeTo(Schema.Trim));`
    ),
    inScript(
      `${schema} const Same = Schema.decode({ decode: id, encode: id });`
    ),
    inScript(`const parsed = Other.decodeUnknownSync(Allowlist)(json);`),
    inApp(`${schema} const parsed = Schema.decodeUnknownSync(Body)(json);`),
    inApp(
      `${config} const read = Effect.gen(function* () { const all = yield* Config.all({ a: Config.string("A"), b: Config.string("B") }); });`
    ),
    inApp(
      `${shared} const banner = Effect.gen(function* () { const title = yield* APP_TITLE; yield* Effect.log(title); const url = yield* APP_URL; });`
    ),
    inApp(
      `${config} const read = Effect.gen(function* () { const user = yield* findUser; const post = yield* findPost; });`
    ),
    inApp(
      `${shared} const read = Effect.gen(function* () { const title = yield* APP_TITLE; });`
    ),
  ],
  invalid: [
    decodeReported(
      `${schema} const parsed = Schema.decodeUnknownResult(Allowlist)(json);`
    ),
    decodeReported(
      `${schema} const parsed = Schema.decodeUnknownSync(Allowlist, { errors: "first" })(json);`
    ),
    decodeReported(
      `${schema} const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Payload));`
    ),
    decodeReported(
      `${schema} const parsed = Schema.decodeSync(Allowlist)(input, { onExcessProperty: "error" });`
    ),
    decodeReported(
      `import * as Schema from "effect/Schema"; const parsed = Schema.decodeUnknownExit(Allowlist)(json);`
    ),
    decodeReported(
      `import { decodeUnknownEffect } from "effect/Schema"; const parsed = decodeUnknownEffect(Allowlist)(json);`
    ),
    {
      code: `${schema} const parsed = Schema.decodeUnknownSync(Settings)(raw);`,
      filename: "/repo/apps/effect/src/shared/config.ts",
      options: [OPTIONS],
      errors: [{ messageId: "firstErrorOnly" }],
    },
    {
      code: `${schema} const parsed = Schema.decodeUnknownSync(Body)(json);`,
      filename: "apps/effect/src/server/body.ts",
      errors: [{ messageId: "firstErrorOnly" }],
    },
    configReported(
      `${shared} const banner = Effect.gen(function* () { const title = yield* APP_TITLE; const url = yield* APP_URL; });`
    ),
    configReported(
      `${shared} const read = Effect.gen(function* () { const title = yield* APP_TITLE; const url = yield* APP_URL; const port = yield* PORT; });`
    ),
    configReported(
      `${config} const LIMIT = Config.int("LIMIT"); const NAME = Config.string("NAME").pipe(Config.withDefault("x")); const read = Effect.gen(function* () { const limit = yield* LIMIT; const name = yield* NAME; });`
    ),
    configReported(
      `${config} const read = Effect.gen(function* () { const a = yield* Config.string("A"); yield* Config.string("B"); });`
    ),
    configReported(
      `import { MAX_IN_FLIGHT_REQUESTS, MAX_IN_FLIGHT_PROBES } from "../shared/config"; const read = Effect.gen(function* () { const requests = yield* MAX_IN_FLIGHT_REQUESTS; const probes = yield* MAX_IN_FLIGHT_PROBES; });`
    ),
  ],
});
