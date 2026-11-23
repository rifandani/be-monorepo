import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";

import { ALLOWED_ORIGIN } from "./origin.ts";

const originFrom = (appUrl: string) =>
  Effect.provide(
    ALLOWED_ORIGIN,
    ConfigProvider.layer(ConfigProvider.fromEnvRecord({ APP_URL: appUrl }))
  );

describe("the allowed origin", () => {
  it.effect("drops the trailing slash a URL stringifies with", () =>
    Effect.map(
      originFrom("https://effect.be-monorepo.localhost/"),
      (origin) => {
        assert.strictEqual(origin, "https://effect.be-monorepo.localhost");
      }
    )
  );

  it.effect("keeps only the scheme, host and port", () =>
    Effect.map(
      originFrom("https://effect.be-monorepo.localhost:8443/app?x=1#top"),
      (origin) => {
        assert.strictEqual(origin, "https://effect.be-monorepo.localhost:8443");
      }
    )
  );
});
