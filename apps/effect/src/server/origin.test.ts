import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";

import { ALLOWED_ORIGIN } from "./origin.ts";

const originFrom = (appUrl: string) =>
  Effect.runSync(
    Effect.provide(
      ALLOWED_ORIGIN,
      ConfigProvider.layer(ConfigProvider.fromEnvRecord({ APP_URL: appUrl }))
    )
  );

describe("the allowed origin", () => {
  it("drops the trailing slash a URL stringifies with", () => {
    assert.strictEqual(
      originFrom("https://effect.be-monorepo.localhost/"),
      "https://effect.be-monorepo.localhost"
    );
  });

  it("keeps only the scheme, host and port", () => {
    assert.strictEqual(
      originFrom("https://effect.be-monorepo.localhost:8443/app?x=1#top"),
      "https://effect.be-monorepo.localhost:8443"
    );
  });
});
