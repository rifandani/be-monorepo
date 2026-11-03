import { PORT } from "#core/constants/global.ts";

import { app } from "./app.ts";

export default {
  fetch: app.fetch,
  port: PORT,
};
