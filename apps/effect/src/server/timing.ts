import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

const HEADER = "server-timing";

const TOTAL = "total";
const TOTAL_DESCRIPTION = "Total Response Time";
const PRECISION = 1;

export const now = (): number => globalThis.performance.now();

export const timing = HttpRouter.middleware(
  (httpEffect) =>
    Effect.suspend(() => {
      const start = now();

      return httpEffect.pipe(
        Effect.map((response) =>
          HttpServerResponse.setHeader(
            response,
            HEADER,
            `${TOTAL};dur=${(now() - start).toFixed(
              PRECISION
            )};desc="${TOTAL_DESCRIPTION}"`
          )
        )
      );
    }),
  { global: true }
);
