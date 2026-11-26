import {
  Cause,
  Clock,
  Data,
  Duration,
  Effect,
  Exit,
  Option,
  Predicate,
  Ref,
  Schema,
} from "effect";
import { HttpServerRespondable, HttpServerResponse } from "effect/http";

import { failureClass } from "./error.ts";

export interface BreakerPolicy {
  readonly threshold: number;
  readonly cooldownMillis: number;
}

export type BreakerState = Data.TaggedEnum<{
  Closed: { readonly failures: number };
  Open: { readonly until: number };
  HalfOpen: { readonly since: number };
}>;

export const BreakerState = Data.taggedEnum<BreakerState>();

export const CLOSED: BreakerState = BreakerState.Closed({ failures: 0 });

export type Ticket = "call" | "probe";

export type Outcome = "success" | "fault" | "refusal" | "interrupted";

export type BreakerStatus = "closed" | "open" | "half-open";

export type Decision =
  | { readonly ticket: Ticket; readonly state: BreakerState }
  | {
      readonly ticket: undefined;
      readonly state: BreakerState;
      readonly retryAfterMillis: number;
    };

const openUntil = (now: number, policy: BreakerPolicy): BreakerState =>
  BreakerState.Open({ until: now + policy.cooldownMillis });

export const admit = (state: BreakerState, now: number): Decision =>
  BreakerState.$match(state, {
    Closed: (): Decision => ({ state, ticket: "call" }),
    HalfOpen: (): Decision => ({
      retryAfterMillis: 0,
      state,
      ticket: undefined,
    }),
    Open: ({ until }): Decision =>
      now < until
        ? { retryAfterMillis: until - now, state, ticket: undefined }
        : { state: BreakerState.HalfOpen({ since: now }), ticket: "probe" },
  });

const settleCall = (
  state: BreakerState,
  outcome: Outcome,
  now: number,
  policy: BreakerPolicy
): BreakerState =>
  BreakerState.$match(state, {
    Closed: ({ failures }): BreakerState => {
      if (outcome === "interrupted") {
        return state;
      }

      if (outcome !== "fault") {
        return CLOSED;
      }

      return failures + 1 >= policy.threshold
        ? openUntil(now, policy)
        : BreakerState.Closed({ failures: failures + 1 });
    },
    HalfOpen: (): BreakerState => state,
    Open: (): BreakerState => state,
  });

const settleProbe = (
  outcome: Outcome,
  now: number,
  policy: BreakerPolicy
): BreakerState => {
  if (outcome === "interrupted") {
    return BreakerState.Open({ until: now });
  }

  return outcome === "fault" ? openUntil(now, policy) : CLOSED;
};

export const settle = (
  state: BreakerState,
  ticket: Ticket,
  outcome: Outcome,
  now: number,
  policy: BreakerPolicy
): BreakerState =>
  ticket === "probe"
    ? settleProbe(outcome, now, policy)
    : settleCall(state, outcome, now, policy);

export const statusAt = (state: BreakerState, now: number): BreakerStatus =>
  BreakerState.$match(state, {
    Closed: (): BreakerStatus => "closed",
    HalfOpen: (): BreakerStatus => "half-open",
    Open: ({ until }): BreakerStatus => (now < until ? "open" : "half-open"),
  });

export const BREAKER_POLICY: BreakerPolicy = {
  cooldownMillis: Duration.toMillis(Duration.seconds(30)),
  threshold: 5,
};

const SERVICE_UNAVAILABLE_STATUS = 503;

const MILLIS_PER_SECOND = 1000;

export class CircuitOpen extends Schema.TaggedError<CircuitOpen>()(
  "CircuitOpen",
  { dependency: Schema.String, retryAfterSeconds: Schema.Int },
  {
    description:
      "The circuit breaker of a dependency is open, so the call was not sent",
    identifier: "CircuitOpen",
    httpApiStatus: SERVICE_UNAVAILABLE_STATUS,
  }
) {
  readonly status = SERVICE_UNAVAILABLE_STATUS;

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(
      HttpServerResponse.empty({
        headers: { "retry-after": String(this.retryAfterSeconds) },
        status: this.status,
      })
    );
  }
}

const isRefusal = (cause: Cause.Cause<unknown>): boolean => {
  if (Cause.hasDies(cause)) {
    return false;
  }

  const error = Option.getOrUndefined(Cause.findErrorOption(cause));

  return (
    Predicate.hasProperty(error, "status") &&
    Predicate.isNumber(error.status) &&
    failureClass(error.status) === "refusal"
  );
};

const outcomeOf = <A, E>(exit: Exit.Exit<A, E>): Outcome => {
  if (Exit.isSuccess(exit)) {
    return "success";
  }

  if (Cause.hasInterruptsOnly(exit.cause)) {
    return "interrupted";
  }

  return isRefusal(exit.cause) ? "refusal" : "fault";
};

const toRetryAfterSeconds = (millis: number): number =>
  Math.max(1, Math.ceil(millis / MILLIS_PER_SECOND));

interface BreakerCheck {
  readonly name: string;
  readonly verify: Effect.Effect<void, Error>;
}

interface Breaker {
  readonly dependency: string;
  readonly protect: <A, E, R>(
    call: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | CircuitOpen, R>;
  readonly status: Effect.Effect<BreakerStatus>;
  readonly readiness: BreakerCheck;
}

const logTransition = (
  dependency: string,
  before: BreakerStatus,
  after: BreakerStatus
): Effect.Effect<void> => {
  if (before === after) {
    return Effect.void;
  }

  return Effect.logWarning(`Circuit breaker is ${after}`).pipe(
    Effect.annotateLogs({ dependency, from: before, to: after })
  );
};

export const makeBreaker = Effect.fn("makeBreaker")(function* makeBreaker(
  dependency: string,
  policy: BreakerPolicy = BREAKER_POLICY
) {
  const state = yield* Ref.make<BreakerState>(CLOSED);

  const release = (ticket: Ticket, outcome: Outcome) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.flatMap(
        Ref.modify(
          state,
          (before): [readonly [BreakerState, BreakerState], BreakerState] => {
            const after = settle(before, ticket, outcome, now, policy);

            return [[before, after], after];
          }
        ),
        ([before, after]) =>
          logTransition(dependency, statusAt(before, now), statusAt(after, now))
      )
    );

  const protect = <A, E, R>(
    call: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | CircuitOpen, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* guarded() {
        const now = yield* Clock.currentTimeMillis;

        const decision = yield* Ref.modify(state, (current) => {
          const next = admit(current, now);

          return [next, next.state];
        });

        if (decision.ticket === undefined) {
          return yield* new CircuitOpen({
            dependency,
            retryAfterSeconds: toRetryAfterSeconds(decision.retryAfterMillis),
          });
        }

        const { ticket } = decision;

        return yield* restore(call).pipe(
          Effect.onExit((exit) => release(ticket, outcomeOf(exit)))
        );
      })
    );

  const status = Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.map(Ref.get(state), (current) => statusAt(current, now))
  );

  const readiness: BreakerCheck = {
    name: `circuit:${dependency}`,
    verify: Effect.flatMap(status, (current) =>
      current === "open"
        ? Effect.fail(new Error(`The circuit breaker of ${dependency} is open`))
        : Effect.void
    ),
  };

  return { dependency, protect, readiness, status } satisfies Breaker;
});
