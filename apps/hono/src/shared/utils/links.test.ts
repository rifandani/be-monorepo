import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { absoluteUrl, nextActions, nextActionsMarkdown } from "./links.ts";

const authContract = {
  paths: {
    "/sign-in/email": {
      post: {
        description: "Sign in with email and password",
        operationId: "signInEmail",
      },
    },
    "/sign-up/email": {
      post: {
        description: "Sign up a user using email and password",
        operationId: "signUpWithEmailAndPassword",
      },
    },
    "/verify-email": {
      get: { description: "Verify the email of the user" },
    },
  },
  servers: [{ url: "https://api.example.test/api/auth" }],
};

describe(absoluteUrl, () => {
  it("should put the path below the base URL", () => {
    const href = absoluteUrl(
      "https://api.example.test/api/auth",
      "/sign-up/email"
    );

    expect(href).toBe("https://api.example.test/api/auth/sign-up/email");
  });

  it("should keep one slash between a base with a trailing slash and the path", () => {
    const href = absoluteUrl("https://api.example.test/", "/llms.txt");

    expect(href).toBe("https://api.example.test/llms.txt");
  });

  it("should keep a path template as written", () => {
    const href = absoluteUrl("https://api.example.test", "/callback/{id}");

    expect(href).toBe("https://api.example.test/callback/{id}");
  });

  it("should always give an absolute URL that ends with the path", () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.webPath(), (base, path) => {
        const href = absoluteUrl(base, path);

        expect(URL.canParse(href)).toBeTruthy();
        expect(href.endsWith(path.replace(/^\/+/u, ""))).toBeTruthy();
      })
    );
  });
});

describe(nextActions, () => {
  it("should list each operation of the contract as an absolute link, in contract order", () => {
    const actions = nextActions(authContract, "https://fallback.example.test");

    expect(actions).toStrictEqual([
      {
        href: "https://api.example.test/api/auth/sign-in/email",
        method: "POST",
        title: "Sign in with email and password",
      },
      {
        href: "https://api.example.test/api/auth/sign-up/email",
        method: "POST",
        title: "Sign up a user using email and password",
      },
      {
        href: "https://api.example.test/api/auth/verify-email",
        method: "GET",
        title: "Verify the email of the user",
      },
    ]);
  });

  it("should use the fallback base URL when the contract names no server", () => {
    const actions = nextActions(
      { paths: { "/llms-docs": { get: { summary: "LLMs Docs" } } } },
      "https://api.example.test"
    );

    expect(actions).toStrictEqual([
      {
        href: "https://api.example.test/llms-docs",
        method: "GET",
        title: "LLMs Docs",
      },
    ]);
  });

  it("should put a relative server URL below the fallback base URL", () => {
    const actions = nextActions(
      {
        paths: { "/ok": { get: { summary: "Health" } } },
        servers: [{ url: "/api/auth" }],
      },
      "https://api.example.test"
    );

    expect(actions.map(({ href }) => href)).toStrictEqual([
      "https://api.example.test/api/auth/ok",
    ]);
  });

  it("should prefer the summary, then the description, then the operation ID as the title", () => {
    const actions = nextActions(
      {
        paths: {
          "/a": { get: { description: "described", summary: "summarised" } },
          "/b": { get: { description: "described", operationId: "opB" } },
          "/c": { get: { operationId: "opC" } },
          "/d": { get: {} },
        },
      },
      "https://api.example.test"
    );

    expect(actions.map(({ title }) => title)).toStrictEqual([
      "summarised",
      "described",
      "opC",
      "GET /d",
    ]);
  });

  it("should skip path-item fields that are not operations", () => {
    const pathItem = {
      get: { summary: "Health" },
      parameters: [],
      summary: "path summary",
    };

    const actions = nextActions(
      { paths: { "/ok": pathItem } },
      "https://api.example.test"
    );

    expect(actions.map(({ method }) => method)).toStrictEqual(["GET"]);
  });

  it("should give no actions for a contract without paths", () => {
    const actions = nextActions({}, "https://api.example.test");

    expect(actions).toStrictEqual([]);
  });

  it("should always give one action per operation, each below the server URL", () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.uniqueArray(fc.webPath({ size: "-1" }).map((path) => `/p${path}`)),
        fc.subarray(["get", "post", "put", "delete"], { minLength: 1 }),
        (server, paths, methods) => {
          const contract = {
            paths: Object.fromEntries(
              paths.map((path) => [
                path,
                Object.fromEntries(methods.map((method) => [method, {}])),
              ])
            ),
            servers: [{ url: server }],
          };

          const actions = nextActions(
            contract,
            "https://fallback.example.test"
          );

          expect(actions).toHaveLength(paths.length * methods.length);

          for (const { href } of actions) {
            expect(href.startsWith(server.replace(/\/+$/u, ""))).toBeTruthy();
          }
        }
      )
    );
  });
});

describe(nextActionsMarkdown, () => {
  it("should write a Next actions section with one link per action", () => {
    const markdown = nextActionsMarkdown([
      {
        href: "https://api.example.test/api/auth/sign-in/email",
        method: "POST",
        title: "Sign in with email and password",
      },
    ]);

    expect(markdown).toBe(
      "## Next actions\n\n- POST [Sign in with email and password](https://api.example.test/api/auth/sign-in/email)\n"
    );
  });

  it("should escape brackets in a title so the link stays one link", () => {
    const markdown = nextActionsMarkdown([
      {
        href: "https://api.example.test/x",
        method: "GET",
        title: "List [all]",
      },
    ]);

    expect(markdown).toContain("[List \\[all\\]](https://api.example.test/x)");
  });

  it("should write nothing when there are no actions", () => {
    const markdown = nextActionsMarkdown([]);

    expect(markdown).toBe("");
  });
});
