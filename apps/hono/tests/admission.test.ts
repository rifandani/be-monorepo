import { describe, expect, it } from "vitest";

import { app } from "#app/app.ts";
import { RETRY_AFTER_SECONDS } from "#server/middleware/admission.ts";
import { ENV } from "#shared/constants/env.ts";

interface Held {
  readonly entered: Promise<boolean>;
  readonly end: () => void;
  readonly response: Promise<Response>;
}

const holdSignIn = (): Held => {
  const entered = Promise.withResolvers<boolean>();

  let close = () => {
    entered.resolve(false);
  };

  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      entered.resolve(true);
      close = () => {
        controller.close();
      };
    },
  });

  const response = Promise.resolve(
    app.request("/api/auth/sign-in/email", {
      body,
      duplex: "half",
      headers: { "Content-Type": "application/json", Origin: ENV.APP_URL },
      method: "POST",
    } as RequestInit)
  );

  return {
    end: () => {
      close();
    },
    entered: entered.promise,
    response,
  };
};

describe("app admission control", () => {
  it("answers the request after the in-flight limit with 503 and Retry-After", async () => {
    const held = Array.from({ length: ENV.MAX_IN_FLIGHT_REQUESTS }, holdSignIn);
    await Promise.all(held.map(async (request) => request.entered));

    const rejected = await app.request("/llms.txt");

    for (const request of held) {
      request.end();
    }

    await Promise.all(held.map(async (request) => request.response));
    const after = await app.request("/llms.txt");

    expect(rejected.status).toBe(503);
    expect(rejected.headers.get("Retry-After")).toBe(
      String(RETRY_AFTER_SECONDS)
    );
    expect(rejected.headers.get("X-Request-Id")).not.toBeNull();
    await expect(rejected.json()).resolves.toStrictEqual({
      message: "Service Unavailable",
    });
    expect(after.status).toBe(200);
  });
});
