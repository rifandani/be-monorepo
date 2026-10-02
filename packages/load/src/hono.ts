/**
 * Hono app scenario. `get-session` with a bearer token is the only route that
 * reaches Postgres on every call; the other two are anonymous, so they skip
 * the session lookup the auth context middleware does for credentialed calls.
 *
 * Sign-in runs once, in `setup()`, and never in the loop: it is mostly
 * password-hash CPU, and in production better-auth allows 3 of them per 10 s.
 *
 * Run it through `run.ts` (e.g. `bun load:hono:smoke http://localhost:3000`),
 * which sets the env below.
 *
 * Env:
 *   LOAD_TARGET          base URL of the app, no trailing slash
 *   LOAD_USER_EMAIL      the user `setup()` signs in as
 *   LOAD_USER_PASSWORD
 */
import { check } from "k6";
import exec from "k6/execution";
import http from "k6/http";

import { expectOk, profileOptions } from "./profiles.ts";

export { handleSummary } from "./profiles.ts";

const BASE_URL = __ENV.LOAD_TARGET;

const ROUTES = {
  "get-session": { path: "/api/auth/get-session", weight: 0.5 },
  "llms-docs": { path: "/llms-docs", weight: 0.2 },
  openapi: { path: "/openapi", weight: 0.3 },
} as const;
type Route = keyof typeof ROUTES;

export const options = profileOptions(Object.keys(ROUTES));

interface SetupData {
  token: string;
}

export const setup = (): SetupData => {
  const response = http.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    JSON.stringify({
      email: __ENV.LOAD_USER_EMAIL,
      password: __ENV.LOAD_USER_PASSWORD,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
  // The bearer plugin returns the session token in this header.
  const token = response.headers["Set-Auth-Token"];
  if (response.status !== 200 || !token) {
    exec.test.abort(
      `sign-in as ${__ENV.LOAD_USER_EMAIL} failed with ${response.status}. ` +
        "Run `bun hono db:seed` first, or set LOAD_USER_EMAIL and LOAD_USER_PASSWORD."
    );
  }
  return { token: token ?? "" };
};

const pickRoute = (): Route => {
  const roll = Math.random();
  if (roll < ROUTES["get-session"].weight) {
    return "get-session";
  }
  return roll < ROUTES["get-session"].weight + ROUTES.openapi.weight
    ? "openapi"
    : "llms-docs";
};

export default function hono(data: SetupData) {
  const route = pickRoute();
  const headers: Record<string, string> =
    route === "get-session" ? { Authorization: `Bearer ${data.token}` } : {};
  const response = http.get(`${BASE_URL}${ROUTES[route].path}`, {
    headers,
    tags: { name: route },
  });
  expectOk(response);
  if (route === "get-session") {
    // An unknown token still answers 200, with a `null` body.
    check(response, {
      // An error body may not be JSON, and `json()` throws on that.
      "session is present": (r) =>
        r.status === 200 && r.json("session") !== null,
    });
  }
}
