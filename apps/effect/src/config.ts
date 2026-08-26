import { Config } from "effect";

/**
 * Environment, as `Config` rather than a schema validated at module load.
 *
 * A `Config<T>` is an `Effect<T, ConfigError>`, so nothing is read until the
 * layer that needs it is built. A missing or malformed variable therefore fails
 * the server's startup with a typed error instead of throwing during an import,
 * which is what keeps the tests free of any environment at all.
 */
export const APP_TITLE = Config.nonEmptyString("APP_TITLE");

/**
 * `portless` injects `PORTLESS_URL` (including the subdomain prefix it gives a
 * worktree), which is more accurate than anything the env file can state, so it
 * wins when present.
 */
export const APP_URL = Config.url("PORTLESS_URL").pipe(
  Config.orElse(() => Config.url("APP_URL"))
);

/**
 * Also injected by the portless proxy.
 *
 * The default is what makes `dev:server` and `node:dev:server` runnable on
 * their own. Those scripts exist to be called by `portless run`, which sets
 * `PORT`, but they are ordinary scripts and a developer will run one directly.
 * Without a default that is a startup `ConfigError`, not a server.
 */
export const PORT = Config.port("PORT").pipe(Config.withDefault(3000));
