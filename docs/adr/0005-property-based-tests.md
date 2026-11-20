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

## Considered options

**`@fast-check/vitest` (`it.prop`, `g`).** It was our first choice for `apps/hono`. We rejected it because the vitest lint plugin finds test blocks from the `vitest` import only. When `it` comes from `@fast-check/vitest`, `no-standalone-expect` fails on every test in the file, and `prefer-importing-vitest-globals` adds a second `it` import that does not compile. A change to the lint rules did not fix this.

**fast-check in `apps/effect`.** We rejected it so that we do not replace the existing `@effect/vitest` tests or run Effect code through `Effect.runPromise` in a property. As a result there are two engines. The shared budget and the shared replay line make the cost of two engines small.

**A fixed seed in CI.** We rejected it. CI runs only `test:cov`, so a fixed seed there would mean that CI never tries a new input. The example tests keep the 90% per-file gate of ADR-0001 stable. Properties only add inputs to code that the examples already cover.

**A random seed under Stryker.** We rejected it. A mutant could survive one run and be killed in the next, so two reports could not be compared (ADR-0002). The 25 runs also keep the mutation run near its old length, because each mutant runs the full test set.

**A time budget (`interruptAfterTimeLimit`).** We rejected it. The number of runs would then depend on the speed of the machine, so coverage and mutation results would change from one machine to the next.
