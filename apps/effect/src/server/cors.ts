import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";

import { ALLOWED_ORIGIN } from "./origin.ts";

export const cors = Layer.unwrap(
  Effect.map(ALLOWED_ORIGIN, (origin) =>
    HttpRouter.cors({
      allowedHeaders: ["Content-Type", "Authorization"],
      allowedMethods: ["GET", "POST", "OPTIONS"],
      allowedOrigins: [origin],
      credentials: true,
      exposedHeaders: ["Content-Length"],
    })
  )
);
