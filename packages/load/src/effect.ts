/**
 * Effect app scenario. The app has no database and no auth, so this measures
 * the Middleware Chain and the router, and nothing behind them.
 *
 * Run it through `run.ts` (e.g. `bun load:effect:smoke http://localhost:3000`),
 * which sets the env below.
 *
 * Env:
 *   LOAD_TARGET   base URL of the app, no trailing slash
 */
import http from "k6/http";

import { expectOk, profileOptions } from "./profiles.ts";

export { handleSummary } from "./profiles.ts";

const BASE_URL = __ENV.LOAD_TARGET;

/**
 * The Readiness Probe, not the Liveness Probe: it is the one of the three
 * that runs its Checks and keeps its span, so it is the one that does work.
 */
const ROUTES = {
  openapi: { path: "/openapi", weight: 0.4 },
  ready: { path: "/health/ready", weight: 0.6 },
} as const;

export const options = profileOptions(Object.keys(ROUTES));

export default function effect() {
  const route = Math.random() < ROUTES.ready.weight ? "ready" : "openapi";
  const response = http.get(`${BASE_URL}${ROUTES[route].path}`, {
    tags: { name: route },
  });
  expectOk(response);
}
