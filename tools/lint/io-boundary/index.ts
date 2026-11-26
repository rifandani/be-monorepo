import { definePlugin } from "@oxlint/plugins";

import { noAmbientEnv } from "./rules/no-ambient-env.ts";
import { requireQueryLimit } from "./rules/require-query-limit.ts";
import { validatedHttpResponse } from "./rules/validated-http-response.ts";

export default definePlugin({
  meta: { name: "io-boundary" },
  rules: {
    "no-ambient-env": noAmbientEnv,
    "require-query-limit": requireQueryLimit,
    "validated-http-response": validatedHttpResponse,
  },
});
