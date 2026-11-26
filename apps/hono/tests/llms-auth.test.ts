import { describe, expect, it } from "vitest";

import { app } from "#app/app.ts";
import { ENV } from "#shared/constants/env.ts";

import { parseServerTimingHeader } from "./util.ts";

describe("/llms-auth.txt endpoint", () => {
  it("should return the auth schema and have Server-Timing with total duration under 1s", async () => {
    const res = await app.request("/llms-auth.txt");
    const text = await res.text();
    const serverTiming = res.headers.get("Server-Timing");
    const dur = parseServerTimingHeader(serverTiming);

    expect(res.status).toBe(200);
    expect(text).toMatch(/# Better Auth/u);
    expect(dur).not.toBeNull();
    expect(dur).toBeLessThan(1000);
  });

  it("links the sign-up, verify and sign-in steps as absolute links", async () => {
    const res = await app.request("/llms-auth.txt");
    const text = await res.text();
    const authUrl = `${ENV.APP_URL}/api/auth`;

    expect(text).toContain("## Next actions");
    expect(text).toContain(
      `- POST [Sign up a user using email and password](${authUrl}/sign-up/email)`
    );
    expect(text).toContain(
      `- GET [Verify the email of the user](${authUrl}/verify-email)`
    );
    expect(text).toContain(
      `- POST [Sign in with email and password](${authUrl}/sign-in/email)`
    );
  });
});
