import { RuleTester } from "oxlint/plugins-dev";

import { boundedRetryRule } from "./bounded-retry.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const imports = `
	import { Effect, Schedule } from "effect";
	import * as Stream from "effect/Stream";
`;

const unbounded = (call: string) => ({
  messageId: "unbounded",
  data: { call },
});
const forever = { messageId: "forever" };
const kyLimit = { messageId: "kyLimit" };

const source = "/repo/apps/effect/src/features/payments/client.ts";
const hono = "/repo/apps/hono/src/features/payments/client.ts";

tester.run("anti-slop-effect/bounded-retry", boundedRetryRule, {
  valid: [
    {
      filename: source,
      code: `${imports}
			export const charge = Effect.retry(send, Schedule.recurs(3));
			export const refund = send.pipe(Effect.retry({ times: 2 }));`,
    },
    {
      filename: source,
      code: `${imports}
			export const backoff = Schedule.exponential("100 millis").pipe(
				Schedule.jittered,
				Schedule.upTo({ times: 5 })
			);
			export const charge = Effect.retry(send, backoff);
			export const refund = Effect.retry(send, { schedule: Schedule.spaced("1 second"), times: 3 });
			export const capture = Effect.retry(send, { until: (error) => error._tag === "Refused" });
			export const settle = Effect.retry(send, { while: isTransient });
			export const once = Effect.retry(send, Schedule.once);`,
    },
    {
      filename: source,
      code: `${imports}
			export const short = Effect.retry(send, Schedule.max([Schedule.spaced("1 second"), Schedule.recurs(3)]));
			export const both = Effect.retry(send, Schedule.min([Schedule.recurs(2), Schedule.during("5 seconds")]));
			export const capped = Effect.retry(send, Schedule.upTo(Schedule.spaced("1 second"), { duration: "30 seconds" }));
			export const window = Effect.retry(send, urgent ? Schedule.recurs(5) : Schedule.once);
			export const builder = Effect.retry(send, ($) => $(Schedule.recurs(2)));
			export const fallback = Effect.retryOrElse(send, Schedule.recurs(2), () => Effect.succeed(null));
			export const stream = events.pipe(Stream.retry(Schedule.during("10 seconds")));`,
    },
    {
      filename: "/repo/apps/effect/src/features/payments/client.test.ts",
      code: `${imports}
			const ticks = Effect.repeat(tick, Schedule.forever);`,
    },
    {
      filename: "/repo/apps/effect/tests/helpers.ts",
      code: `${imports}
			export const poll = Effect.repeat(check, Schedule.forever);`,
    },
    {
      filename: hono,
      code: `
			import ky from "ky";
			export const api = ky.create({ retry: { limit: 2, methods: ["get"] } });
			export const once = ky.get(url, { retry: 0 });`,
    },
    {
      filename: hono,
      code: `
			export const drain = createDrain({ retry: { maxAttempts: 3 } });`,
    },
    {
      filename: source,
      code: `
			export const retried = Effect.retry(send, policy);
			export const looped = Schedule.forever;`,
    },
  ],
  invalid: [
    {
      filename: source,
      code: `${imports}
			export const charge = Effect.retry(send, Schedule.spaced("1 second"));
			export const refund = send.pipe(Effect.retry({ schedule: Schedule.exponential("100 millis") }));`,
      errors: [unbounded("Effect.retry"), unbounded("Effect.retry")],
    },
    {
      filename: source,
      code: `${imports}
			const backoff = Schedule.exponential("100 millis").pipe(Schedule.jittered);
			export const charge = Effect.retry(send, backoff);
			export const either = Effect.retry(send, Schedule.min([Schedule.recurs(3), Schedule.spaced("1 second")]));
			export const uncapped = Effect.retry(send, Schedule.spaced("1 second").pipe(Schedule.upTo({})));
			export const chained = Effect.retry(send, Schedule.concat(Schedule.recurs(2), Schedule.fixed("1 second")));
			export const empty = Effect.retry(send, {});
			export const branch = Effect.retry(send, urgent ? Schedule.recurs(5) : Schedule.spaced("1 second"));`,
      errors: [
        unbounded("Effect.retry"),
        unbounded("Effect.retry"),
        unbounded("Effect.retry"),
        unbounded("Effect.retry"),
        unbounded("Effect.retry"),
        unbounded("Effect.retry"),
      ],
    },
    {
      filename: source,
      code: `${imports}
			import { retryPolicy } from "./policy.ts";
			export const charge = Effect.retry(send, retryPolicy);
			export const refund = Effect.retry(send, { ...defaults });`,
      errors: [unbounded("Effect.retry"), unbounded("Effect.retry")],
    },
    {
      filename: source,
      code: `${imports}
			export const fallback = send.pipe(Effect.retryOrElse(Schedule.spaced("1 second"), () => Effect.succeed(null)));
			export const stream = Stream.retry(events, Schedule.fibonacci("10 millis"));`,
      errors: [unbounded("Effect.retryOrElse"), unbounded("Stream.retry")],
    },
    {
      filename: source,
      code: `${imports}
			export const charge = Effect.retry(send, Schedule.forever);
			export const heartbeat = Effect.repeat(ping, Schedule.forever);`,
      errors: [unbounded("Effect.retry"), forever],
    },
    {
      filename: "/repo/apps/effect/src/features/payments/client.test.ts",
      code: `${imports}
			const charge = Effect.retry(send, Schedule.spaced("1 second"));`,
      errors: [unbounded("Effect.retry")],
    },
    {
      filename: "/repo/apps/effect/fixtures/clock.ts",
      code: `${imports}
			export const ticks = Effect.repeat(tick, Schedule.forever);`,
      options: [{ testFiles: ["apps/*/tests/**"] }],
      errors: [forever],
    },
    {
      filename: hono,
      code: `
			import ky from "ky";
			export const api = ky.create({ retry: { methods: ["get", "post"] } });
			export const charge = ky.post(url, { json: body, retry: { statusCodes: [503] } });`,
      errors: [kyLimit, kyLimit],
    },
  ],
});
