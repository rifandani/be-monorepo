import { MOCK_API_BASE_URL, server } from "@test/msw";
import {
  authKeys,
  authRepositories,
  authSignInEmailRequestSchema,
  authSignUpEmailRequestSchema,
} from "@workspace/core/apis/auth";
import { Http } from "@workspace/core/services/http";
import { HTTPError } from "ky";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

const url = (path: string) => `${MOCK_API_BASE_URL}/api/auth/${path}`;

const user = {
  createdAt: "2024-01-01T00:00:00.000Z",
  email: "ada@example.com",
  emailVerified: true,
  id: "u1",
  name: "Ada",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const session = {
  createdAt: "2024-01-01T00:00:00.000Z",
  expiresAt: "2024-01-02T00:00:00.000Z",
  id: "s1",
  ipAddress: "127.0.0.1",
  token: "t1",
  updatedAt: "2024-01-01T00:00:00.000Z",
  userAgent: "vitest",
  userId: "u1",
};

const echoHeader = { "x-test": "1" };

const signInJson = {
  email: "ada@example.com",
  password: "password1",
  rememberMe: true,
};

const signUpJson = {
  email: "ada@example.com",
  name: "Ada",
  password: "password1",
};

/** `authRepositories` takes `Http` by parameter, so the test owns the base URL. */
const repositories = () =>
  authRepositories(new Http({ prefix: MOCK_API_BASE_URL }));

describe("auth request schemas", () => {
  it("rejects names and passwords below the Better Auth minimums", () => {
    expect(
      authSignUpEmailRequestSchema.safeParse({
        email: "ada@example.com",
        name: "Ad",
        password: "password1",
      }).success
    ).toBeFalsy();
    expect(
      authSignUpEmailRequestSchema.safeParse({
        email: "ada@example.com",
        name: "Ada",
        password: "short",
      }).success
    ).toBeFalsy();
    expect(
      authSignUpEmailRequestSchema.safeParse(signUpJson).success
    ).toBeTruthy();
  });

  it("omits name from sign-in and requires rememberMe", () => {
    expect(
      authSignInEmailRequestSchema.safeParse({
        email: "ada@example.com",
        password: "password1",
        rememberMe: true,
      }).success
    ).toBeTruthy();
    // `omit({ name: true })` — a name field must not be required on sign-in.
    expect(
      authSignInEmailRequestSchema.safeParse({
        email: "ada@example.com",
        name: "Ada",
        password: "password1",
        rememberMe: true,
      }).success
    ).toBeTruthy();
    expect(
      authSignInEmailRequestSchema.safeParse({
        email: "ada@example.com",
        password: "password1",
      }).success
    ).toBeFalsy();
  });
});

describe(authRepositories, () => {
  it("builds authKeys without params", () => {
    expect(authKeys.all()).toStrictEqual(["auth"]);
    expect(authKeys.signOut()).toStrictEqual(["auth", "signOut"]);
    expect(authKeys.signInEmail()).toStrictEqual(["auth", "signInEmail"]);
    expect(authKeys.signUpEmail()).toStrictEqual(["auth", "signUpEmail"]);
  });

  it("builds authKeys with params", () => {
    expect(authKeys.signInEmail(signInJson)).toStrictEqual([
      "auth",
      "signInEmail",
      signInJson,
    ]);
    expect(authKeys.signUpEmail(signUpJson)).toStrictEqual([
      "auth",
      "signUpEmail",
      signUpJson,
    ]);
  });

  it("getSession parses the session and returns response headers", async () => {
    server.use(
      http.get(url("get-session"), () =>
        HttpResponse.json({ session, user }, { headers: echoHeader })
      )
    );

    const result = await repositories().getSession();

    expect(result.json?.user.email).toBe("ada@example.com");
    expect(result.json?.session.id).toBe("s1");
    expect(result.headers.get("x-test")).toBe("1");
  });

  it("getSession accepts a null body, since the schema is nullable", async () => {
    server.use(http.get(url("get-session"), () => HttpResponse.json(null)));

    const result = await repositories().getSession();

    expect(result.json).toBeNull();
  });

  it("signInEmail posts the credentials and parses the response", async () => {
    let captured: unknown;
    server.use(
      http.post(url("sign-in/email"), async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          { redirect: false, token: "tok", url: null },
          { headers: echoHeader }
        );
      })
    );

    const result = await repositories().signInEmail({ json: signInJson });

    expect(captured).toStrictEqual(signInJson);
    expect(result.json.token).toBe("tok");
    expect(result.json.redirect).toBeFalsy();
    expect(result.headers.get("x-test")).toBe("1");
  });

  it("signInEmail forwards ky options", async () => {
    let captured: Request | undefined;
    server.use(
      http.post(url("sign-in/email"), ({ request }) => {
        captured = request;
        return HttpResponse.json({ redirect: false, token: "tok", url: null });
      })
    );

    await repositories().signInEmail({
      json: signInJson,
      headers: { "x-trace": "abc" },
    });

    expect(captured?.headers.get("x-trace")).toBe("abc");
  });

  it("signOut posts and parses success", async () => {
    let capturedRequest: Request | undefined;
    server.use(
      http.post(url("sign-out"), ({ request }) => {
        capturedRequest = request;
        return HttpResponse.json({ success: true });
      })
    );

    const result = await repositories().signOut();

    expect(capturedRequest?.method).toBe("POST");
    expect(result.json.success).toBeTruthy();
  });

  it("signUpEmail posts the registration and parses the response", async () => {
    let captured: unknown;
    server.use(
      http.post(url("sign-up/email"), async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ token: "tok" });
      })
    );

    const result = await repositories().signUpEmail({ json: signUpJson });

    expect(captured).toStrictEqual(signUpJson);
    expect(result.json.token).toBe("tok");
  });

  it("getSession rejects when the response violates the schema", async () => {
    server.use(
      http.get(url("get-session"), () =>
        HttpResponse.json({ session, user: { ...user, email: "nope" } })
      )
    );

    await expect(repositories().getSession()).rejects.toThrow(/Invalid/u);
  });

  it("signInEmail rejects when the response violates the schema", async () => {
    server.use(
      http.post(url("sign-in/email"), () =>
        HttpResponse.json({ redirect: "no", token: "tok", url: null })
      )
    );

    await expect(
      repositories().signInEmail({ json: signInJson })
    ).rejects.toThrow(/Invalid/u);
  });

  it("signUpEmail rejects when the response violates the schema", async () => {
    server.use(
      http.post(url("sign-up/email"), () => HttpResponse.json({ token: 123 }))
    );

    await expect(
      repositories().signUpEmail({ json: signUpJson })
    ).rejects.toThrow(/Invalid/u);
  });

  it("signOut rejects when the response violates the schema", async () => {
    server.use(
      http.post(url("sign-out"), () => HttpResponse.json({ success: "yes" }))
    );

    await expect(repositories().signOut()).rejects.toThrow(/Invalid/u);
  });

  it("signInEmail rejects on a 401", async () => {
    server.use(
      http.post(url("sign-in/email"), () =>
        HttpResponse.json(
          { message: "Invalid email or password" },
          { status: 401 }
        )
      )
    );

    await expect(
      repositories().signInEmail({ json: signInJson })
    ).rejects.toThrow(HTTPError);
  });

  it("signOut rejects on a 500", async () => {
    server.use(
      http.post(url("sign-out"), () => new HttpResponse(null, { status: 500 }))
    );

    await expect(repositories().signOut()).rejects.toThrow(HTTPError);
  });
});
