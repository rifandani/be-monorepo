import { RuleTester } from "oxlint/plugins-dev";

import { validatedHttpResponse } from "./validated-http-response.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const zod =
  'import { z } from "zod"; const User = z.object({ id: z.string() });';

const schema =
  'import { Schema } from "effect"; const User = Schema.Struct({ id: Schema.String });';

const http =
  'import { Effect } from "effect"; import { HttpClient, HttpClientResponse } from "effect/http"; import { Schema } from "effect"; const User = Schema.Struct({ id: Schema.String });';

const reported = (code: string, messageId: string) => ({
  code,
  errors: [{ messageId }],
});

tester.run("io-boundary/validated-http-response", validatedHttpResponse, {
  valid: [
    `${zod} async function load() { return User.parse(await ky.get("u").json()); }`,
    `${zod} async function load() { return User.safeParse(await response.json()); }`,
    `${zod} async function load() { return await User.parseAsync(await response.json()); }`,
    `${zod} async function load() { return User.safeParseAsync(await response.json()); }`,
    `${schema} async function load() { return Schema.decodeUnknownSync(User)(await response.json()); }`,
    `${schema} async function load() { return Schema.decodeUnknownEffect(User)(await response.json()); }`,
    `${schema} const decode = Schema.decodeUnknownSync(User); async function load() { return decode(await response.json()); }`,
    `import { decodeUnknownSync } from "effect/Schema"; async function load() { return decodeUnknownSync(User)(await response.json()); }`,
    `${zod} async function load() { return await ky.get("u").json(User); }`,
    'app.get("/", (c) => c.json({ ok: true }));',
    'const ready = (r) => r.json("session") !== null;',
    "const later = () => response.json();",
    `${http} const load = Effect.gen(function* () { const response = yield* HttpClient.get("/u").pipe(Effect.flatMap(HttpClientResponse.filterStatusOk)); return yield* HttpClientResponse.schemaBodyJson(User)(response); });`,
    `${http} const load = HttpClient.get("/u").pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.flatMap(HttpClientResponse.schemaBodyJson(User)));`,
    `${http} const load = Effect.gen(function* () { const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk); const response = yield* client.get("/u"); return yield* HttpClientResponse.schemaBodyJson(User)(response); });`,
    `import { Effect } from "effect"; import * as HttpClient from "effect/http/HttpClient"; import { filterStatusOk, schemaBodyJson } from "effect/http/HttpClientResponse"; const load = HttpClient.get("/u").pipe(Effect.flatMap(filterStatusOk), Effect.flatMap(schemaBodyJson(User)));`,
    'import { HttpClient } from "./local-client.ts"; const load = HttpClient.get("/u");',
    'const HttpClient = { get: (url) => url }; const load = HttpClient.get("/u");',
  ],
  invalid: [
    ...[
      "async function load() { return await response.json(); }",
      "async function load() { return (await response.json()) as User; }",
      'async function load() { return await ky.get("u").json<User>(); }',
      'function load() { return ky.get("u").json<User>(); }',
      `${zod} async function load() { const body = await response.json(); return User.parse(body); }`,
      `${zod} async function load() { return User.parse({ data: await response.json() }); }`,
      "async function load() { return JSON.parse(await response.json()); }",
      "async function load() { return Date.parse(await response.json()); }",
      "async function load() { return URL.parse(await response.json()); }",
      `${schema} async function load() { return Schema.decodeSync(User)(await response.json()); }`,
      `${schema} async function load() { return Schema.is(User)(await response.json()); }`,
    ].map((code) => reported(code, "unvalidatedJson")),
    ...[
      `${http} const load = HttpClient.get("/u").pipe(Effect.flatMap((r) => r.json));`,
      `${http} const load = HttpClient.get("/u").pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(User)));`,
      `${http} const load = HttpClient.get("/u").pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));`,
      `${http} const load = Effect.gen(function* () { const client = yield* HttpClient.HttpClient; const response = yield* client.get("/u"); return yield* response.json; });`,
      `${http} const load = Effect.gen(function* () { const client = yield* HttpClient.HttpClient; return yield* client.execute(request).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk)); });`,
      `${http} const ok = HttpClientResponse.filterStatusOk; const decode = HttpClientResponse.schemaBodyJson(User); function load() { return HttpClient.post("/u"); }`,
      `${http} const api = { ok: HttpClientResponse.filterStatusOk, decode: HttpClientResponse.schemaBodyJson(User), load: () => HttpClient.get("/u") };`,
      'import { HttpClient, HttpClientRequest } from "effect/http"; const load = HttpClient.post("/u").pipe(HttpClientRequest.schemaBodyJson(User), HttpClient.filterStatusOk);',
    ].map((code) => reported(code, "unvalidatedPipeline")),
  ],
});
