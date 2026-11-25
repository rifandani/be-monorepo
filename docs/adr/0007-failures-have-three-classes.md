---
status: accepted
---

# Failures have three classes

A failed request is one of three classes. Each class has its own HTTP status range and its own log level. If a handler catches every failure and returns success, or gives all failures one status, the caller cannot tell which repair is necessary. We decide that both API apps keep the three classes separate, from the place of the failure to the response.

## The classes

| Class                | Cause                                                                                          | Status                | Log level | Retry                    |
| -------------------- | ---------------------------------------------------------------------------------------------- | --------------------- | --------- | ------------------------ |
| Refusal              | The request is not correct: invalid input, missing access, an unknown route. A typed error.   | 400–499               | `info`    | Not without a change     |
| Infrastructure fault | A dependency failed: an upstream call, a timeout, a server abort, a dependency that is not ready. | 502, 503 or 504       | `warn`    | Yes, the same request    |
| Defect               | A bug: an unexpected throw, `Effect.die`, a status that cannot be an error status.            | 500                   | `error`   | No. Fix the code         |

The status selects the class: 400–499 is a refusal, 502–504 is an infrastructure fault, and all other statuses are a defect. The handlers log a refusal at `info`, because the client must change the request. They log an infrastructure fault at `warn`, because an operator can repair it without a code change. They log only a defect at `error`.

## The response body

- A **refusal** body contains:
  - `message`: what is wrong.
  - `location`: the part of the request that is wrong, when the handler knows it. Examples: a field path such as `address.city`, `(root)` for the full value, `body`, or the request path without the query string.
  - `rejected`: the rejected value, only if it is safe to show. Do not show a value that can be a password, a token, a key or personal data. If you are not sure, do not show it.
  - `fix`: a repair hint that tells the client what to change.
- An **infrastructure fault** body contains only `message`, which is the reason phrase of the status (for example `Bad Gateway`). It does not show the upstream body or internal detail.
- A **defect** body contains only `message: "Internal Server Error"`. It never shows the defect message or the stack.

The handler writes these bodies only when the failure has no body. Some code chooses its own response: an Effect `HttpServerResponse`, a Hono `HTTPException`, or an evlog error from `createError`. The handler keeps that body. The handler still uses the status of that response to select the log level. An evlog error is written for the client, so its `message`, `why`, `fix` and `link` are safe to show, also with status 500.

## The error handlers

`apps/hono/src/app/app.ts` (`onError`):

- `ZodError` → refusal, 400, with `location` from the first issue path and a `fix`.
- ky `HTTPError` → infrastructure fault, 502. An upstream rejection is not the client's mistake.
- ky `TimeoutError` → infrastructure fault, 504.
- `HTTPException` → its own response. The class comes from its status.
- evlog error (`createError`) → its own status and hints. The class comes from the status. A status that cannot carry a body becomes 500.
- Any other error → defect, 500.
- `notFound` → refusal, 404, with the request path as `location` and a `fix` that points to `/openapi`.

The evlog Hono middleware calls `log.error()` for each error that `onError` handles. This records the error and its stack on the wide event, but it also sets the level to `error`. Thus `onError` calls `log.setLevel()` with the level of the class. A level that `setLevel()` gives stays, also after a later `log.error()`.

`apps/effect/src/server/error.ts` (`onError` and `toErrorResponse`):

- `HttpServerError.causeResponse` selects the status. The class comes from that status.
- A request parse failure is a refusal with `location: "body"`. If an unknown route gets to this handler, it is a refusal with the request path as `location`. Usually the `notFound` middleware answers an unknown route first.
- An interrupt by the server is an infrastructure fault, 503.
- A defect is 500.

`apps/effect/src/server/not-found.ts` (`notFound`) answers an unknown route as a refusal, 404, with the request path as `location` and a `fix` that points to `/openapi`.

## Where a failure can become a success

The lint rule `anti-slop-effect/no-defect-swallowing` stops code that turns a failure into a success with `Effect.catch`, `Effect.catchAll`, `Effect.catchCause`, `Effect.catchDefect`, `Effect.ignore`, `Effect.ignoreCause` or `Effect.orElseSucceed`. Recover from a named error with `Effect.catchTag` or `Effect.catchTags`, or fail again after you log.

Only a reporting boundary can turn a failure into a success, because it reports the failure truthfully in its result. The rule option `allow` in `oxlint.config.ts` names these files:

- `apps/effect/src/server/error.ts`: turns each failure into the response of its class.
- `apps/effect/src/features/health/service.ts`: turns a failed readiness check into a `fail` check. The readiness probe then fails with `Unhealthy`, an infrastructure fault (503).

The rule does not check test files. A test can ignore a failure to examine something else.

The rule cannot check the response bodies or the status of each class. The route tests in `apps/hono/tests/error-handling.test.ts` and `apps/effect/tests/error.test.ts` check one example of each class.

## References

- [Errors are part of the interface](https://ratstack.sh/lore/errors-are-part-of-the-interface)
- [Failures keep their meaning](https://ratstack.sh/lore/failures-keep-their-meaning)
- [Handle expected failures without hiding defects](https://ratstack.sh/lore/error-model)
