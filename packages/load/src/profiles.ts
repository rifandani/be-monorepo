/**
 * Load profiles — the five test types, and the k6 options each one runs with.
 *
 * k6 code, not Node code: it runs inside the k6 runtime, which reads `__ENV`
 * and the `k6/*` modules. `run.ts` is the only Node side, and it passes every
 * value below in as `-e KEY=value`.
 *
 * Every type but smoke uses an arrival-rate executor (an open model). A VU
 * executor sends less when the app slows down, which hides exactly the latency
 * a load test is meant to find.
 *
 * Env (all optional):
 *   LOAD_RATE   peak requests per second. Smoke ignores it.
 *   LOAD_HOLD   how long the peak is held. For breakpoint, the length of the ramp.
 */
import type { SummaryData } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";
import { check } from "k6";
import type { RefinedResponse, ResponseType } from "k6/http";
import { Counter } from "k6/metrics";
import type { Options, Scenario } from "k6/options";

const PROFILES = ["smoke", "load", "stress", "spike", "breakpoint"] as const;
type Profile = (typeof PROFILES)[number];

/**
 * A 429 means the test hit a rate limiter, not the app's limit. Its own
 * counter, held at zero, says so in the summary instead of folding it into
 * `http_req_failed`.
 */
const rateLimited = new Counter("rate_limited");

/** Asserts a 200, and counts a 429 against `rate_limited`. */
export const expectOk = (response: RefinedResponse<ResponseType>) => {
  if (response.status === 429) {
    rateLimited.add(1);
  }
  return check(response, { "status is 200": (r) => r.status === 200 });
};

interface Budget {
  /** Upper bound for `http_req_failed`, as a rate. */
  failed: number;
  /** p95 latency in ms, for the whole run and for each route. */
  p95: number;
  /** p99 latency in ms, when the type has one. */
  p99?: number;
  /** Lower bound for the `checks` pass rate, when the type has one. */
  checks?: number;
}

interface Plan {
  budget: Budget;
  scenario: (rate: number, hold: string) => Scenario;
  defaultHold: string;
  defaultRate: number;
  /** Stop the run at the first failed threshold. */
  abortOnFail?: boolean;
}

/**
 * Enough VUs to keep the offered rate when each request takes up to about
 * one second. k6 warns, and counts `dropped_iterations`, when it runs out.
 */
const vuPool = (rate: number) => ({
  maxVUs: Math.max(rate * 2, 50),
  preAllocatedVUs: Math.max(Math.ceil(rate / 10), 10),
});

const PLANS: Record<Profile, Plan> = {
  breakpoint: {
    abortOnFail: true,
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

/** `__ENV` value, or the profile default when the variable is unset. */
const envOr = (key: string, fallback: string): string => __ENV[key] || fallback;

/** A threshold expression, or an aborting threshold when the plan says so. */
const limit = (plan: Plan, expression: string) =>
  plan.abortOnFail
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

/**
 * The k6 options for the profile named in `LOAD_PROFILE`, with one p95
 * threshold for each route name. A route's requests must carry the same
 * value in their `name` tag, or its threshold has no samples.
 */
export const profileOptions = (routes: readonly string[]): Options => {
  const profile = __ENV.LOAD_PROFILE;
  if (!isProfile(profile)) {
    throw new Error(
      `LOAD_PROFILE must be one of ${PROFILES.join(", ")}, got ${profile}`
    );
  }

  const plan = PLANS[profile];
  const rate = Number(envOr("LOAD_RATE", String(plan.defaultRate)));
  const hold = envOr("LOAD_HOLD", plan.defaultHold);
  return {
    scenarios: { [profile]: plan.scenario(rate, hold) },
    thresholds: thresholdsFor(plan, routes),
  };
};

/**
 * Prints the usual text summary, and writes the same data as JSON to
 * `LOAD_SUMMARY_PATH` when `run.ts` gives one. Exporting `handleSummary` turns
 * k6's own summary off, which is why the text one is rebuilt here.
 */
export const handleSummary = (data: SummaryData) => {
  const stdout = textSummary(data, { enableColors: true, indent: " " });
  const path = __ENV.LOAD_SUMMARY_PATH;
  if (!path) {
    return { stdout };
  }
  return { [path]: JSON.stringify(data, null, 2), stdout };
};
