import { defineRule } from "@oxlint/plugins";
import type { RuleOptionsSchema } from "@oxlint/plugins";
import { Schema } from "effect";

import { isAllowed, isTestPath } from "../shared/allow-option.ts";
import {
  collectEffectModuleNames,
  keyName,
  moduleMemberName,
  unwrapNode,
} from "../shared/effect-modules.ts";

const UNOWNED_STEPS: ReadonlySet<string> = new Set([
  "forkDetach",
  "forkDaemon",
  "runFork",
  "runForkWith",
]);
const SOURCE_FILES: readonly string[] = ["src/**"];
const DEFAULT_ENTRY_POINTS: readonly string[] = ["apps/*/src/app/**"];

const optionsSchema: RuleOptionsSchema = [
  {
    type: "object",
    properties: {
      entryPoints: { type: "array", items: { type: "string" } },
      testFiles: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
];

const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({
        entryPoints: Schema.optionalKey(Schema.Array(Schema.String)),
        testFiles: Schema.optionalKey(Schema.Array(Schema.String)),
      })
    ),
  ])
);

export const boundedOwnedConcurrencyRule = defineRule({
  meta: {
    type: "problem",
    schema: optionsSchema,
    docs: {
      description:
        'Forbid `concurrency: "unbounded"`, and forbid detached fibers outside entry points.',
    },
    messages: {
      unbounded:
        '`concurrency: "unbounded"` starts one fiber for each input, with no limit. A large input exhausts connections, memory or a rate limit. Fix: set a number, for example `concurrency: 8`, from a named constant.',
      unowned:
        "`{{call}}` starts a fiber that no parent owns. Its failures are lost, and it continues after the request ends. Fix: use `Effect.forkChild` or `Effect.forkScoped`, or `Effect.forkIn` with a Layer scope. Start the runtime with `Effect.runFork` only in an entry point (the `entryPoints` option).",
    },
  },
  create(context) {
    const names = collectEffectModuleNames(context.sourceCode.ast);
    const usesEffect = names.size > 0;
    const [option] = decodeOptions(context.options);
    const checksForks =
      isAllowed(context.filename, SOURCE_FILES) &&
      !isTestPath(context.filename, option?.testFiles) &&
      !isAllowed(context.filename, option?.entryPoints ?? DEFAULT_ENTRY_POINTS);

    return {
      MemberExpression(node) {
        const step = moduleMemberName(node, names, "Effect");

        if (checksForks && step !== null && UNOWNED_STEPS.has(step)) {
          context.report({
            node,
            messageId: "unowned",
            data: { call: `Effect.${step}` },
          });
        }
      },
      Property(node) {
        const value = unwrapNode(node.value);

        if (
          usesEffect &&
          !node.computed &&
          keyName(node.key) === "concurrency" &&
          value.type === "Literal" &&
          value.value === "unbounded"
        ) {
          context.report({ node, messageId: "unbounded" });
        }
      },
    };
  },
});
