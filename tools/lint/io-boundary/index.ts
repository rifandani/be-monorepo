import { definePlugin } from "@oxlint/plugins";

import { requireQueryLimit } from "./rules/require-query-limit.ts";
import { validatedHttpResponse } from "./rules/validated-http-response.ts";

export default definePlugin({
  meta: { name: "io-boundary" },
  rules: {
    "require-query-limit": requireQueryLimit,
    "validated-http-response": validatedHttpResponse,
  },
});
