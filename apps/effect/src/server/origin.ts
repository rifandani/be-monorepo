import { Config } from "effect";

import { APP_URL } from "#shared/config.ts";

export const ALLOWED_ORIGIN: Config.Config<string> = Config.map(
  APP_URL,
  (url) => url.origin
);
