import type { SummaryData } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";
import { check } from "k6";
import http from "k6/http";
import type { RefinedResponse, ResponseType } from "k6/http";
import { Counter } from "k6/metrics";
import type { Options, Scenario } from "k6/options";

const PROFILES = ["smoke", "load", "stress", "spike", "breakpoint"] as const;

type Profile = (typeof PROFILES)[number];

const rateLimited = new Counter("rate_limited");
const shed = new Counter("shed");

const expectShedWithRetryAfter = (response: RefinedResponse<ResponseType>) => {
  shed.add(1);

  return check(response, {
    "a 503 has Retry-After": (r) => (r.headers["Retry-After"] ?? "") !== "",
  });
};

export const expectOk = (response: RefinedResponse<ResponseType>) => {
  if (response.status === 429) {
    rateLimited.add(1);
  }

  if (response.status === 503) {
    return expectShedWithRetryAfter(response);
  }

  return check(response, { "status is 200": (r) => r.status === 200 });
};

interface Budget {
  failed: number;
  p95: number;
  p99?: number;
  checks?: number;
}

interface Plan {
  budget: Budget;
  scenario: (rate: number, hold: string) => Scenario;
  defaultHold: string;
  defaultRate: number;
  abortOnFail?: boolean;
  expectsShedding?: boolean;
}

const vuPool = (rate: number) => ({
  maxVUs: Math.max(rate * 2, 50),
  preAllocatedVUs: Math.max(Math.ceil(rate / 10), 10),
});

const PLANS: Record<Profile, Plan> = {
  breakpoint: {
    abortOnFail: true,
    expectsShedding: true,
    budget: { failed: 0.05, p95: 1000 },
    defaultHold: "10m",
    defaultRate: 5000,
    scenario: (rate, hold) => ({
      executor: "ramping-arrival-rate",
      stages: [{ duration: hold, target: rate }],
      startRate: 0,
      timeUnit: "1s",
      ...vuPool(rate),
    }),
  },
  load: {
    budget: { failed: 0.01, p95: 200, p99: 500 },
    defaultHold: "5m",
    defaultRate: 100,
    scenario: (rate, hold) => ({
      executor: "ramping-arrival-rate",
      stages: [
        { duration: "1m", target: rate },
        { duration: hold, target: rate },
        { duration: "30s", target: 0 },
      ],
      startRate: 0,
      timeUnit: "1s",
      ...vuPool(rate),
    }),
  },
  smoke: {
    budget: { checks: 1, failed: 0, p95: 300 },
    defaultHold: "30s",
    defaultRate: 0,
    scenario: (_rate, hold) => ({
      duration: hold,
      executor: "constant-vus",
      vus: 1,
    }),
  },
  spike: {
    expectsShedding: true,
    budget: { failed: 0.1, p95: 2000 },
    defaultHold: "1m",
    defaultRate: 1000,
    scenario: (rate, hold) => ({
      executor: "ramping-arrival-rate",
      stages: [
        { duration: "10s", target: rate },
        { duration: hold, target: rate },
        { duration: "10s", target: 0 },
      ],
      startRate: 0,
      timeUnit: "1s",
      ...vuPool(rate),
    }),
  },
  stress: {
    expectsShedding: true,
    budget: { failed: 0.05, p95: 1000 },
    defaultHold: "5m",
    defaultRate: 300,
    scenario: (rate, hold) => ({
      executor: "ramping-arrival-rate",
      stages: [
        { duration: "2m", target: rate },
        { duration: hold, target: rate },
        { duration: "1m", target: 0 },
      ],
      startRate: 0,
      timeUnit: "1s",
      ...vuPool(rate),
    }),
  },
};

const isProfile = (value: string | undefined): value is Profile =>
  PROFILES.some((profile) => profile === value);

const envOr = (key: string, fallback: string): string => {
  const value = __ENV[key];

  return value !== undefined && value.length > 0 ? value : fallback;
};

const limit = (plan: Plan, expression: string) =>
  plan.abortOnFail === true
    ? { abortOnFail: true, delayAbortEval: "30s", threshold: expression }
    : expression;

const durationThresholds = (plan: Plan) => {
  const { budget } = plan;
  const duration = [limit(plan, `p(95)<${budget.p95}`)];

  if (budget.p99 !== undefined) {
    duration.push(limit(plan, `p(99)<${budget.p99}`));
  }

  return duration;
};

const thresholdsFor = (
  plan: Plan,
  routes: readonly string[]
): NonNullable<Options["thresholds"]> => {
  const { budget } = plan;

  const thresholds: NonNullable<Options["thresholds"]> = {
    http_req_duration: durationThresholds(plan),
    "http_req_duration{status:200}": [`p(95)<${budget.p95}`],
    http_req_failed: [limit(plan, `rate<=${budget.failed}`)],
    rate_limited: ["count==0"],
    ...Object.fromEntries(
      routes.map((route) => [
        `http_req_duration{name:${route}}`,
        [`p(95)<${budget.p95}`],
      ])
    ),
  };

  if (budget.checks !== undefined) {
    thresholds.checks = [`rate>=${budget.checks}`];
  }

  return thresholds;
};

export const profileOptions = (routes: readonly string[]): Options => {
  const profile = __ENV.LOAD_PROFILE;

  if (!isProfile(profile)) {
    throw new Error(
      `LOAD_PROFILE must be one of ${PROFILES.join(", ")}, got ${profile}`
    );
  }

  const plan = PLANS[profile];

  if (plan.expectsShedding === true) {
    http.setResponseCallback(http.expectedStatuses(200, 503));
  }

  const rate = Number(envOr("LOAD_RATE", String(plan.defaultRate)));
  const hold = envOr("LOAD_HOLD", plan.defaultHold);

  return {
    scenarios: { [profile]: plan.scenario(rate, hold) },
    thresholds: thresholdsFor(plan, routes),
  };
};

export const handleSummary = (data: SummaryData) => {
  const stdout = textSummary(data, { enableColors: true, indent: " " });
  const path = __ENV.LOAD_SUMMARY_PATH;

  if (path === undefined || path.length === 0) {
    return { stdout };
  }

  return { [path]: JSON.stringify(data, null, 2), stdout };
};
