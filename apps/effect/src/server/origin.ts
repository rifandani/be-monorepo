import { Config } from "effect";

import { APP_URL } from "#config.ts";

/**
 * The one origin this app trusts.
 *
 * `CONTEXT.md` defines **Allowed Origin**. Two policies read it and neither
 * owns it: `cors.ts` decides who may read a response, `csrf.ts` decides whose
 * state-changing request is honoured. Both used to derive it from `APP_URL`
 * themselves, which made the rule below a thing stated in one of them and
 * silently repeated in the other.
 *
 * `url.origin` and not `url.toString()`: a `URL` stringifies with a trailing
 * slash and a browser sends `Origin` without one, so the full string would
 * never match. `origin` is scheme, host and port and nothing else — a path or
 * a query on `APP_URL` is dropped, which is correct, because an origin is not
 * a location.
 *
 * A `Config` and not an `Effect` or a service. Both consumers need the value at
 * layer *build* — `HttpRouter.cors` takes its options there, before any request
 * exists — so a service would push a requirement through `app` into both
 * entrypoints and buy nothing. Left as a `Config`, a missing `APP_URL` fails
 * the layer build, which is the startup failure every other reader of
 * `config.ts` gets.
 *
 * This is a policy premise and not environment, which is why it is here and not
 * in `config.ts`. It also keeps the rule inside the coverage denominator —
 * `config.ts` is excluded from it (see ADR-0001), and a rule with a test
 * belongs where the gate can see it.
 */
// `pipe` and not `Config.map(APP_URL, ...)`, for the reason `cors.ts` gives:
// oxlint reads the second argument of a two-argument `map` as an array
// `thisArg` and reports it.
export const ALLOWED_ORIGIN: Config.Config<string> = APP_URL.pipe(
  Config.map((url) => url.origin)
);
