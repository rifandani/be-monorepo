import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authOptionsWithoutDatabase } from "#server/auth.ts";
import { ENV } from "#shared/constants/env.ts";

const SIGN_UP = "/sign-up/email";
const SIGN_IN = "/sign-in/email";
const SIGN_OUT = "/sign-out";
const GET_SESSION = "/get-session";
const CLIENT_ADDRESS = "203.0.113.7";
const EMAILS = ["ada@example.com", "grace@example.com"] as const;
const PASSWORDS = ["correct-horse-battery", "tr0ub4dor-and-3"] as const;

const TABLE_NAMES = [
  "account",
  "rate_limit",
  "session",
  "user",
  "verification",
] as const;

const LIMITED_PATH_WINDOW_MS = 10_000;
const LIMITED_PATH_MAX_REQUESTS = 3;

type AuthPath =
  | typeof GET_SESSION
  | typeof SIGN_IN
  | typeof SIGN_OUT
  | typeof SIGN_UP;

type LimitedPath = typeof SIGN_IN | typeof SIGN_UP;

interface Outage {
  down: boolean;
}

interface Bucket {
  count: number;
  last: number;
}

interface Model {
  readonly buckets: Map<LimitedPath, Bucket>;
  down: boolean;
  signedInAs: string | null;
  readonly users: Set<string>;
  readonly passwords: Map<string, string>;
}

interface Answer {
  readonly body: unknown;
  readonly retryAfter: string | null;
  readonly status: number;
}

type Outcome = Answer | "failed";

const tokenBody = z.object({ token: z.string() });

const sessionBody = z
  .object({ user: z.object({ email: z.string() }) })
  .nullable();

const storedUser = z.object({ email: z.string() });

const failWhenDown = (outage: Outage) => {
  if (outage.down) {
    throw new Error("database unreachable");
  }
};

const tablesBehind = (outage: Outage): MemoryDB => {
  const rows = new Map<string, MemoryDB[string]>(
    TABLE_NAMES.map((name) => [name, []])
  );

  const tables: MemoryDB = {};

  for (const name of TABLE_NAMES) {
    Object.defineProperty(tables, name, {
      enumerable: true,
      get: () => {
        failWhenDown(outage);

        return rows.get(name) ?? [];
      },
      set: (value: MemoryDB[string]) => {
        failWhenDown(outage);
        rows.set(name, value);
      },
    });
  }

  return tables;
};

const buildAuth = (tables: MemoryDB) =>
  betterAuth({
    ...authOptionsWithoutDatabase,
    database: memoryAdapter(tables),
    emailAndPassword: {
      ...authOptionsWithoutDatabase.emailAndPassword,
      password: {
        hash: async (password) => `plain:${password}`,
        verify: async ({ hash, password }) => hash === `plain:${password}`,
      },
    },
    logger: { disabled: true },
    rateLimit: { ...authOptionsWithoutDatabase.rateLimit, enabled: true },
  });

interface Real {
  auth: ReturnType<typeof buildAuth>;
  readonly outage: Outage;
  readonly tables: MemoryDB;
  token: string | null;
}

type AuthCommand = fc.AsyncCommand<Model, Real>;

const startReal = (): Real => {
  const outage = { down: false };
  const tables = tablesBehind(outage);

  return { auth: buildAuth(tables), outage, tables, token: null };
};

const send = async (
  real: Real,
  path: AuthPath,
  body?: Readonly<Record<string, string>>
): Promise<Outcome> => {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: ENV.APP_URL,
    "X-Forwarded-For": CLIENT_ADDRESS,
  });

  if (real.token !== null) {
    headers.set("Authorization", `Bearer ${real.token}`);
  }

  const request = new Request(`${ENV.APP_URL}/api/auth${path}`, {
    body: body === undefined ? null : JSON.stringify(body),
    headers,
    method: path === GET_SESSION ? "GET" : "POST",
  });

  try {
    const response = await real.auth.handler(request);
    const text = await response.text();

    return {
      body: text === "" ? null : JSON.parse(text),
      retryAfter: response.headers.get("X-Retry-After"),
      status: response.status,
    };
  } catch {
    return "failed";
  }
};

const statusOf = (outcome: Outcome) =>
  outcome === "failed" ? "failed" : outcome.status;

const tokenOf = (outcome: Outcome) =>
  tokenBody.parse(outcome === "failed" ? null : outcome.body).token;

const sessionEmailOf = (outcome: Outcome) =>
  sessionBody.parse(outcome === "failed" ? null : outcome.body)?.user.email ??
  null;

const admit = (model: Model, path: LimitedPath) => {
  const now = Date.now();
  const bucket = model.buckets.get(path);

  if (bucket === undefined || now - bucket.last >= LIMITED_PATH_WINDOW_MS) {
    model.buckets.set(path, { count: 1, last: now });

    return null;
  }

  if (bucket.count >= LIMITED_PATH_MAX_REQUESTS) {
    return String(
      Math.ceil((bucket.last + LIMITED_PATH_WINDOW_MS - now) / 1000)
    );
  }

  bucket.count += 1;
  bucket.last = now;

  return null;
};

const expectInvariants = async (model: Model, real: Real) => {
  if (model.down) {
    return;
  }

  const session = await send(real, GET_SESSION);

  const storedEmails = (real.tables.user ?? []).map(
    (row) => storedUser.parse(row).email
  );

  expect(statusOf(session)).toBe(200);
  expect(sessionEmailOf(session)).toBe(model.signedInAs);
  expect(storedEmails.toSorted()).toStrictEqual([...model.users].toSorted());
};

const expectRefused = (outcome: Outcome, retryAfter: string) => {
  expect(outcome).toMatchObject({ retryAfter, status: 429 });
};

const signUpCommand = (email: string, password: string): AuthCommand => ({
  check: () => true,
  run: async (model, real) => {
    const outcome = await send(real, SIGN_UP, { email, name: "Ada", password });

    if (model.down) {
      expect(outcome).toBe("failed");

      return;
    }

    const retryAfter = admit(model, SIGN_UP);

    if (retryAfter !== null) {
      expectRefused(outcome, retryAfter);
    } else if (model.users.has(email)) {
      expect(statusOf(outcome)).toBe(422);
    } else {
      expect(statusOf(outcome)).toBe(200);
      model.users.add(email);
      model.passwords.set(email, password);
      model.signedInAs = email;
      real.token = tokenOf(outcome);
    }

    await expectInvariants(model, real);
  },
  toString: () => `signUp(${email}, ${password})`,
});

const signInCommand = (email: string, password: string): AuthCommand => ({
  check: () => true,
  run: async (model, real) => {
    const outcome = await send(real, SIGN_IN, { email, password });

    if (model.down) {
      expect(outcome).toBe("failed");

      return;
    }

    const retryAfter = admit(model, SIGN_IN);

    if (retryAfter !== null) {
      expectRefused(outcome, retryAfter);
    } else if (model.passwords.get(email) === password) {
      expect(statusOf(outcome)).toBe(200);
      model.signedInAs = email;
      real.token = tokenOf(outcome);
    } else {
      expect(statusOf(outcome)).toBe(401);
    }

    await expectInvariants(model, real);
  },
  toString: () => `signIn(${email}, ${password})`,
});

const signOutCommand = (): AuthCommand => ({
  check: () => true,
  run: async (model, real) => {
    const outcome = await send(real, SIGN_OUT);

    if (model.down) {
      expect(outcome).toBe("failed");

      return;
    }

    expect(statusOf(outcome)).toBe(200);
    model.signedInAs = null;

    await expectInvariants(model, real);
  },
  toString: () => "signOut()",
});

const waitCommand = (milliseconds: number): AuthCommand => ({
  check: () => true,
  run: async (model, real) => {
    vi.setSystemTime(Date.now() + milliseconds);

    await expectInvariants(model, real);
  },
  toString: () => `wait(${milliseconds}ms)`,
});

const outageCommand = (): AuthCommand => ({
  check: (model) => !model.down,
  run: async (model, real) => {
    real.outage.down = true;
    model.down = true;

    await expectInvariants(model, real);
  },
  toString: () => "databaseOutage()",
});

const restartCommand = (): AuthCommand => ({
  check: () => true,
  run: async (model, real) => {
    real.outage.down = false;
    real.auth = buildAuth(real.tables);
    model.down = false;

    await expectInvariants(model, real);
  },
  toString: () => "restart()",
});

const anyCommand = () => {
  const email = fc.constantFrom(...EMAILS);
  const password = fc.constantFrom(...PASSWORDS);

  return [
    fc
      .tuple(email, password)
      .map(([address, secret]) => signUpCommand(address, secret)),
    fc
      .tuple(email, password)
      .map(([address, secret]) => signInCommand(address, secret)),
    fc.constant(signOutCommand()),
    fc
      .oneof(
        fc.nat({ max: 2 * LIMITED_PATH_WINDOW_MS }),
        fc.constantFrom(LIMITED_PATH_WINDOW_MS - 1, LIMITED_PATH_WINDOW_MS)
      )
      .map(waitCommand),
    fc.constant(outageCommand()),
    fc.constant(restartCommand()),
  ];
};

const setup = () => {
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

  const model: Model = {
    buckets: new Map(),
    down: false,
    passwords: new Map(),
    signedInAs: null,
    users: new Set(),
  };

  return { model, real: startReal() };
};

describe("/api/auth/** flow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs up, signs in, refuses the fourth sign-in in ten seconds and signs out", async () => {
    const real = startReal();
    const ada = { email: EMAILS[0], name: "Ada", password: PASSWORDS[0] };

    const signedUp = await send(real, SIGN_UP, ada);
    const first = await send(real, SIGN_IN, ada);
    const second = await send(real, SIGN_IN, ada);
    const third = await send(real, SIGN_IN, ada);
    const fourth = await send(real, SIGN_IN, ada);
    real.token = tokenOf(first);
    const signedOut = await send(real, SIGN_OUT);
    const session = await send(real, GET_SESSION);

    expect([signedUp, first, second, third].map(statusOf)).toStrictEqual([
      200, 200, 200, 200,
    ]);
    expect(fourth).toMatchObject({ retryAfter: "10", status: 429 });
    expect(statusOf(signedOut)).toBe(200);
    expect(sessionEmailOf(session)).toBeNull();
  });

  it("should always agree with the model over any sequence of auth actions, outages and restarts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(anyCommand(), { size: "+1" }),
        async (commands) => {
          await expect(
            fc.asyncModelRun(setup, commands)
          ).resolves.toBeUndefined();
        }
      )
    );
  });
});
