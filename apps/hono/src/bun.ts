import { PORT } from "#core/constants/global.ts";

import { app } from "./app.ts";

// SAFETY: spreading `app` copies its `fetch` handler and the rest of the Bun.serve contract, which the spread's inferred type loses; the assertion restates the app shape plus the `port` added on the line above.
export default {
  ...app,
  port: PORT,
} as typeof app & {
  port: number;
};
