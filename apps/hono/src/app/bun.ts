import { ENV } from "#shared/constants/env.ts";

import { app } from "./app.ts";

export default {
  fetch: app.fetch,
  port: ENV.PORT,
};
