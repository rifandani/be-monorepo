import { Layer } from "effect";
import type { Config } from "effect";
import type { HttpRouter } from "effect/unstable/http";

import { cors } from "./cors.ts";
import { csrf } from "./csrf.ts";
import { onError } from "./error.ts";
import { language } from "./language.ts";
import { metrics } from "./metrics.ts";
import { notFound } from "./not-found.ts";
import { quietProbes } from "./probes.ts";
import { requestId } from "./request-id.ts";
import { secureHeaders } from "./secure-headers.ts";
import { timeout } from "./timeout.ts";
import { timing } from "./timing.ts";

/**
 * What every entry in the chain is.
 *
 * The error channel is `ConfigError` because two of the eleven have one:
 * `cors` and `csrf` are `Layer.unwrap`ped over the Allowed Origin, which is a
 * `Config`. `Layer.flatMap` unions the error channels, so the composed chain
 * carries it either way — this type states what the fold already produced when
 * it was written out by hand.
 */
type MiddlewareLayer = Layer.Layer<
  never,
  Config.ConfigError,
  HttpRouter.HttpRouter
>;

/**
 * The Middleware Chain, outermost first. `CONTEXT.md` defines the term.
 *
 * This is the one statement of the order. It used to be the shape of a
 * `Layer.flatMap` staircase, with the order restated in prose above it — and
 * the prose drifted: it claimed ten entries where there are eleven, and
 * `docs/adr/0003` inherited the same count. A tuple has a length nothing has to
 * maintain, and `tests/middleware.test.ts` asserts that every entry in it
 * actually registers.
 *
 * `Layer.flatMap` and not `Layer.mergeAll`: a global middleware registers when
 * its layer builds, `mergeAll` builds its members concurrently, and the
 * registration order is the nesting order — so `mergeAll` would leave the
 * nesting to whichever layer won the race.
 *
 * Seven of these are the seven `apps/hono` mounts (`src/app.ts`), in that app's
 * order but for `secureHeaders`, which states on its entry why it moves.
 * `metrics` and `quietProbes` are additions that app has no counterpart for,
 * not departures from its order.
 *
 * The order is worth having stated because the nesting decides what a
 * short-circuited request keeps. Move an entry and what such a response carries
 * changes; that is asserted, row by row, in `tests/nesting.test.ts`, which
 * keeps its own hand-written account of the order rather than reading this one.
 * `docs/adr/0005` says why it must stay that way.
 */
export const CHAIN = [
  // Outermost, so every response carries an id — the csrf 403 and the cors
  // preflight included, which is what makes a report about one of those
  // joinable to the log line it produced. It also annotates the logs of
  // everything inside it, which is every middleware here.
  { layer: requestId, name: "requestId" },
  // As far out as it can be. It records the status of the response that
  // actually leaves, so it has to be outside `onError` and `notFound`; being
  // outside `cors` and `csrf` as well is what makes the preflight and the 403
  // count as the served traffic they are. It neither reads nor writes a
  // response, so nothing else in the chain is affected by where it sits.
  { layer: metrics, name: "metrics" },
  // Out here for the same reason as `metrics`, and with the same freedom: it
  // suppresses events rather than touching the response. `apps/hono` has no
  // counterpart for either of these two.
  { layer: quietProbes, name: "quietProbes" },
  // The one entry out of the `apps/hono` order, and on purpose. That app mounts
  // it after csrf, so a rejection there short-circuits before the headers are
  // ever set and the 403 leaves without them. Here it sits outside every
  // middleware that answers on its own, so the csrf 403, the timeout 504 and
  // the cors preflight all carry `nosniff` and the rest. It reads nothing and
  // answers nothing, so nothing else in the chain is affected by where it sits.
  { layer: secureHeaders, name: "secureHeaders" },
  // Fifth. It answers the preflight itself, so everything from `timing` inwards
  // never runs for one — which is the sparse row in `tests/nesting.test.ts`.
  // `docs/adr/0003` is why this and `csrf` stay four apart rather than merging.
  { layer: cors, name: "cors" },
  // Outside `timeout` on purpose: a request given up on is one worth having a
  // `Server-Timing` header for.
  { layer: timing, name: "timing" },
  // Inside `timing`, so its 504 still reports how long the request was given
  // before being given up on. The only entry with a second adapter: see
  // `Overrides` below.
  { layer: timeout, name: "timeout" },
  // Inside `timeout`, which decides the sharpest column in
  // `tests/nesting.test.ts`: a 504 cannot carry the language cookie, because
  // the request was abandoned before this ran. Outside `csrf`, so a rejected
  // request is still answered in the language it asked for.
  { layer: language, name: "language" },
  // The innermost middleware that answers on its own, ninth of eleven. The two
  // inside it act only on failures, so a 403 — a success value — carries
  // everything the eight outside it add, the language cookie included.
  { layer: csrf, name: "csrf" },
  // `onError` and `notFound` are innermost, which is the placement worth
  // stating. Every middleware above sets its headers with `Effect.map`, which
  // runs only on success, so a failure that travelled past them would leave
  // without a request id, a `Server-Timing` header or the security headers.
  // Turning the failure into a response down here, before any of them see it,
  // is what makes a 404 and a 500 carry the same headers a 200 does.
  { layer: onError, name: "onError" },
  // Inside `onError` so the miss it claims never reaches the catch-all.
  { layer: notFound, name: "notFound" },
] as const satisfies readonly {
  readonly layer: MiddlewareLayer;
  readonly name: string;
}[];

type Middleware = (typeof CHAIN)[number];

/**
 * One entry substituted for another, keyed by the name it is declared under.
 *
 * This is the seam, and it has two adapters: the 15 second timeout `timeout.ts`
 * states, and the short one `tests/nesting.test.ts` builds with `timeoutFor`.
 * No route in this app answers slowly enough to exceed 15 seconds, so a 504
 * over the real chain is unreachable — and the 504 is the only response that
 * can show that `timing` sits outside `timeout`.
 *
 * The names come from `CHAIN`, so a typo does not compile. A seam and not the
 * single layer that used to be threaded through `appWith` as a parameter: one
 * substitutable entry needed no name, and eleven cannot share one parameter.
 */
export type Overrides = Partial<Record<Middleware["name"], MiddlewareLayer>>;

/**
 * The chain, built.
 *
 * A left fold, which produces the same term the staircase did: `pipe` with two
 * `Layer.flatMap`s desugars to `flatMap(flatMap(a, …), …)`, and
 * `Layer.flatMap` is `dual(2, …)` building `self` to completion and then the
 * next layer, on the same scope and the same `MemoMap`
 * (`Layer.ts:1662-1679` in the vendored source). So build order, registration
 * order and finalizer order are unchanged by the rewrite.
 *
 * `reduce` needs its type argument written out: `Array.reduce` fixes the
 * accumulator from the seed, and the seed — `requestId` — has no `ConfigError`
 * in its channel, so an inferred fold stops accepting `cors` halfway through.
 *
 * See `cors.ts` for why the body is `pipe` and not the two-argument
 * `Layer.flatMap`. Here it has a second use: the fold is spelled exactly as the
 * staircase it replaced, one line instead of ten.
 */
export const chain = (overrides: Overrides): MiddlewareLayer => {
  const layerOf = (entry: Middleware): MiddlewareLayer =>
    overrides[entry.name] ?? entry.layer;

  const [outermost, ...rest] = CHAIN;

  return rest.reduce<MiddlewareLayer>(
    (composed, entry) => composed.pipe(Layer.flatMap(() => layerOf(entry))),
    layerOf(outermost)
  );
};
