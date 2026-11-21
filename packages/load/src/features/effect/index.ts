import http from "k6/http";

import { expectOk, profileOptions } from "../../shared/profiles.ts";

export { handleSummary } from "../../shared/profiles.ts";

const BASE_URL = __ENV.LOAD_TARGET;

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
