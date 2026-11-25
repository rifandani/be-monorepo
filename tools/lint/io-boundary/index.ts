import { definePlugin } from "@oxlint/plugins";

import { validatedHttpResponse } from "./rules/validated-http-response.ts";

export default definePlugin({
  meta: { name: "io-boundary" },
  rules: {
    "validated-http-response": validatedHttpResponse,
  },
});
