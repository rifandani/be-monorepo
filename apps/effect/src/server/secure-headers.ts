import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

export const SECURE_HEADERS = {
  "cache-control": "no-cache, no-store, must-revalidate",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=15552000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-dns-prefetch-control": "off",
  "x-download-options": "noopen",
  "x-frame-options": "SAMEORIGIN",
  "x-permitted-cross-domain-policies": "none",
  "x-xss-protection": "0",
} as const;

const POWERED_BY = "x-powered-by";

export const secureHeaders = HttpRouter.middleware(
  (httpEffect) =>
    Effect.map(httpEffect, (response) =>
      HttpServerResponse.removeHeader(
        HttpServerResponse.setHeaders(response, SECURE_HEADERS),
        POWERED_BY
      )
    ),
  { global: true }
);
