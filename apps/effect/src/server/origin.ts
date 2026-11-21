import { Config } from "effect";

import { APP_URL } from "#shared/config.ts";

export const ALLOWED_ORIGIN: Config.Config<string> = APP_URL.pipe(
  Config.map((url) => url.origin)
);
