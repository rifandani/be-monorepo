import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";

import { ALLOWED_ORIGIN } from "./origin.ts";

// This project runs its tests without an env file (see `vitest.config.ts`), so
// each case states the environment it is about. `APP_URL` and not
// `PORTLESS_URL`, which `config.ts` prefers when the proxy injects it.
const originFrom = (appUrl: string) =>
  Effect.runSync(
    Effect.provide(
      ALLOWED_ORIGIN,
      ConfigProvider.layer(ConfigProvider.fromEnvRecord({ APP_URL: appUrl }))
    )
  );

describe("the allowed origin", () => {
  // A `URL` stringifies with a trailing slash and a browser sends `Origin`
  // without one, so this is the difference between a policy that matches and
  // one that never does.
  it("drops the trailing slash a URL stringifies with", () => {
    assert.strictEqual(
      originFrom("https://effect.be-monorepo.localhost/"),
      "https://effect.be-monorepo.localhost"
    );
  });

  // An origin is scheme, host and port. Anything more specific is a location,
  // and a browser never puts one in `Origin`.
  it("keeps only the scheme, host and port", () => {
    assert.strictEqual(
      originFrom("https://effect.be-monorepo.localhost:8443/app?x=1#top"),
      "https://effect.be-monorepo.localhost:8443"
    );
  });
});
