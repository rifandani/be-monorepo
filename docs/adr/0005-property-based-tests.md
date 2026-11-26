---
status: accepted
---

# Property-based tests: one engine per app, one budget, one replay line

Example tests document behaviour. Property tests look for the inputs that nobody wrote down. We add a property only where a rule says "always" or "never". The properties go after the example tests in the same file and do not replace them.

## Vocabulary

> **Property** — a statement that must be true for every generated input, for example "the count never goes down inside a window".
>
> **Arbitrary** — a generator of inputs. `fc.ipV4()` in fast-check, `Schema.Int` or `Arbitrary.schema(...)` in Effect.
>
> **Shrinking** — after a failure, the engine tries smaller inputs that still fail and reports the smallest one it finds (the counterexample).
>
> **Seed** — the number that fixes every generated input of a run. With the same seed and the same number of runs, a run gives the same inputs again.
>
> **Path** — the position of a counterexample in the shrinking tree, which fast-check prints next to the seed (`path: "0:1:0"`). The replay line does not use it: the seed and the run count find the same counterexample again.
>
> **Replay line** — the one command added to every failed test, which runs that test again with the seed that failed.

## One engine per app

- `apps/hono` uses `fast-check` directly: `await fc.assert(fc.asyncProperty(...))` inside a normal vitest `it`. Synchronous properties use `fc.assert(fc.property(...))` without `await`. fast-check v4 returns `void` for them, and the `await-thenable` rule refuses an `await` there.
- `apps/effect` uses the Effect `Arbitrary` engine through `it.prop` and `it.effect.prop` of `@effect/vitest`, with `Schema` values as arbitraries. Effect code runs inside the test fiber, with `TestClock` and layers.
- `tools/lint` and `scripts` are not apps, but they use fast-check the same way as `apps/hono`. Each has a `vitest.setup.ts` that gives the shared budget to fast-check.

## One budget for both

`vitest.property.ts` reads the budget from the environment. Each app gives it to its engine in its own `vitest.setup.ts`.

| Where | Runs per property (`PBT_NUM_RUNS`) | Seed (`PBT_SEED`) |
| --- | --- | --- |
| Local and agent runs | 25 | random for each worker |
| CI (`CI` is set) | 100 | random for each worker |
| Stryker (`stryker.config.mjs`) | 25 | fixed, `20260101` |

A value that is set in the environment always wins.

Every failed test gets one more line in its error message:

```text
Replay: PBT_SEED=1656173625 PBT_NUM_RUNS=100 bun run test apps/hono/src/server/client-address.test.ts -t 'should always take the first hop of x-forwarded-for'
```

That line is correct for both engines, because both read the same seed and the same run count. The run count is in the line because one seed gives the same inputs only for the same number of runs. Effect also prints its own replay token. fast-check also prints its `seed` and `path`.

## Model tests for flows with state

A property checks one function. Some rules are about a flow with state, where the order of the actions changes the result: sign up, sign in, the rate limit, sign out. For these rules, write a model test.

> **Model** — a small, plain description of the state that the system must have, for example "the users that exist, and the user that the client is signed in as".
>
> **Command** — one action on the system, with a `check` (can it run in this model state?) and a `run` (do it on the system, update the model, and compare the two).
>
> **Invariant** — a statement that must be true after every command, for example "the session of the client belongs to the user that the model says".

### When to use a model test

- Use one when the result of an action depends on the actions before it, and a single-function property cannot see the rule.
- Do not use one for a pure function. Use a property (above) or an example test.
- A lint rule cannot find the flows that need a model test. The author and the reviewer decide.

### Tooling

- `apps/hono`, `tools/lint` and `scripts` use `fc.commands` and `fc.asyncModelRun` inside one `fc.assert(fc.asyncProperty(...))`. `apps/effect` has no model test yet. Its first model test decides how to write commands with the Effect engine, and adds that decision to this ADR. The run uses the same seed, budget and replay line as the other properties. Nothing more is necessary: the replay line runs the same command sequences again.
- The counterexample is the shortest command sequence that fails. fast-check prints it with the `toString` of each command, so give each command a `toString` that shows its inputs.
- Use `fc.commands(..., { size: "+1" })` when a failure needs many commands, for example a limit that only starts after the fourth request. The default size gives short sequences. With it, a mutant that changed the limit from 3 to 4 passed.
- Add the edge values to the generators of time. A wait of exactly the window length is rare in `fc.nat(...)`. Add it with `fc.oneof(fc.nat(...), fc.constantFrom(window - 1, window))`.
- Control the clock with `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(...)` in `setup`. Fake only `Date`, so that promises and timers in the system continue to operate.
- Each run gets a new model and a new system from `setup`. The runs share no state.

### Recovery

A flow must also be correct after a failure. Thus a model test includes failure and restart commands:

- A **failure** command makes a dependency fail, for example the database. While it fails, each request must fail, and the model must not change.
- A **restart** command builds the system again over the same stored data. The data that was stored before the restart must be the same after it.
- After each command, check the invariants explicitly. Do not use the next command to find a broken state. If you do, the counterexample is longer, and it does not show the command that broke the state.
- While the failure is on, the invariants cannot read the state. Check them again after the restart.

### The first model test

`apps/hono/tests/auth-flow.test.ts` tests the Better Auth flow. Its commands are sign-up, sign-in, sign-out, wait, database outage and restart. After each command, it checks that `/get-session` returns the user that the model says, and that the stored users are the users of the model. The model also holds the sign-in and sign-up rate limit: 3 requests in 10 seconds for each client address and path. This is a built-in rule of Better Auth for `/sign-in*` and `/sign-up*`. It replaces the 150 requests in 15 seconds of `auth.ts` on these paths only. The model checks the `429` and the `X-Retry-After` value. The model does not hold the 150-request limit on `/get-session` and `/sign-out`. One run sends fewer than 150 requests to each of these paths.

The test builds Better Auth from `authOptionsWithoutDatabase` in `src/server/auth.ts`, which are the production options without the database. It changes four things, and only these:

- `database` is the Better Auth `memoryAdapter`, because CI has no Postgres (ADR-0001). Each table is a getter and a setter that throw while the outage is on, so the outage reaches every read and write. The rate limit reads its table first, so each request fails before it writes. This outage cannot find a request that keeps half of a write. To find one, make the outage start after a number of database operations.
- `rateLimit.enabled` is `true`. Better Auth turns rate limiting on only in production, and the limit is part of the flow under test.
- The password hash is a plain function. The default scrypt hash makes a run with many sign-ins too slow, and the hash is not part of the flow.
- The logger is off, so the outage does not print an error for each failed request.

The test calls `auth.handler` directly and not `app.request`, because `app` uses the auth instance over Postgres. Thus this file is an exception to the ADR-0001 rule that `apps/*/tests` use the real `app` with no fakes. The route from `app` to `auth.handler` is one line in `src/features/auth/routes.ts`, and `tests/auth.test.ts` already tests it. When CI gets a database, the model test can use Postgres instead of the memory adapter. The commands and the model stay the same.

## Considered options

**`@fast-check/vitest` (`it.prop`, `g`).** It was our first choice for `apps/hono`. We rejected it because the vitest lint plugin finds test blocks from the `vitest` import only. When `it` comes from `@fast-check/vitest`, `no-standalone-expect` fails on every test in the file, and `prefer-importing-vitest-globals` adds a second `it` import that does not compile. A change to the lint rules did not fix this.

**fast-check in `apps/effect`.** We rejected it so that we do not replace the existing `@effect/vitest` tests or run Effect code through `Effect.runPromise` in a property. As a result there are two engines. The shared budget and the shared replay line make the cost of two engines small.

**A fixed seed in CI.** We rejected it. CI runs only `test:cov`, so a fixed seed there would mean that CI never tries a new input. The example tests keep the 90% per-file gate of ADR-0001 stable. Properties only add inputs to code that the examples already cover.

**A random seed under Stryker.** We rejected it. A mutant could survive one run and be killed in the next, so two reports could not be compared (ADR-0002). The 25 runs also keep the mutation run near its old length, because each mutant runs the full test set.

**A lint rule that requires model tests.** We rejected it. No rule can see which flows have state where the order of the actions matters. This ADR gives the guidance, and the review applies it.

**The model test over Postgres or over `app.request`.** We rejected both for now. CI has no Postgres (ADR-0001), and `app` holds the auth instance over Postgres. The memory adapter runs the same Better Auth code for each request, and only the storage is different.

**A time budget (`interruptAfterTimeLimit`).** We rejected it. The number of runs would then depend on the speed of the machine, so coverage and mutation results would change from one machine to the next.
