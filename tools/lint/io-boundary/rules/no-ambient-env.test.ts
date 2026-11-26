import { RuleTester } from "oxlint/plugins-dev";

import { noAmbientEnv } from "./no-ambient-env.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const CONFIG_MODULES = {
  allow: [
    "apps/hono/src/shared/constants/env.ts",
    "apps/effect/src/shared/config.ts",
    "scripts/**",
  ],
};

const inApp = (code: string) => ({
  code,
  filename: "apps/hono/src/server/db/index.ts",
  options: [CONFIG_MODULES],
});

const reported = (code: string) => ({
  ...inApp(code),
  errors: [{ messageId: "ambientEnv" }],
});

tester.run("io-boundary/no-ambient-env", noAmbientEnv, {
  valid: [
    inApp('import { ENV } from "#shared/constants/env.ts"; ENV.DATABASE_URL;'),
    inApp("const process = { env: {} }; process.env.PORT;"),
    inApp("function read(Bun) { return Bun.env.PORT; }"),
    inApp("const { argv } = process;"),
    inApp("process.exit(1);"),
    inApp("config.env.PORT;"),
    inApp('import { argv } from "node:process";'),
    inApp('import process from "./fake-process.ts"; process.env.PORT;'),
    inApp("const meta = { env: {} }; meta.env.MODE;"),
    {
      code: "export const ENV = createEnv({ runtimeEnv: process.env });",
      filename: "/repo/apps/hono/src/shared/constants/env.ts",
      options: [CONFIG_MODULES],
    },
    {
      code: "const target = process.env.ZAP_TARGET;",
      filename: "/repo/scripts/security/zap.ts",
      options: [CONFIG_MODULES],
    },
    {
      code: "const url = Bun.env.APP_URL;",
      filename: "apps/effect/src/shared/config.ts",
      options: [CONFIG_MODULES],
    },
  ],
  invalid: [
    reported("const level = process.env.NODE_ENV;"),
    reported('const level = process.env["NODE_ENV"];'),
    reported("const env = process.env;"),
    reported('const env = process["env"];'),
    reported("const env = globalThis.process.env;"),
    reported("const { env } = process;"),
    reported("const { env: vars } = process;"),
    reported("const port = Bun.env.PORT;"),
    reported('const port = Deno.env.get("PORT");'),
    reported("const mode = import.meta.env.MODE;"),
    reported('import { env } from "node:process"; env.PORT;'),
    reported('import { env } from "process";'),
    reported('import process from "node:process"; process.env.PORT;'),
    reported('import * as proc from "node:process"; proc.env.PORT;'),
    reported('import { env } from "bun";'),
    {
      code: "const port = process.env.PORT;",
      filename: "apps/hono/src/shared/constants/global.ts",
      errors: [{ messageId: "ambientEnv" }],
    },
    {
      code: "const port = process.env.PORT;",
      filename: "apps/hono/src/shared/constants/global.ts",
      options: [{ allow: ["apps/effect/**"] }],
      errors: [{ messageId: "ambientEnv" }],
    },
  ],
});
