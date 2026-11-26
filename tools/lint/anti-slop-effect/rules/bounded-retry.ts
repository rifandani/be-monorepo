import { defineRule } from "@oxlint/plugins";
import type { ESTree, RuleOptionsSchema, SourceCode } from "@oxlint/plugins";
import { Schema } from "effect";

import { isTestPath } from "../shared/allow-option.ts";
import {
  collectEffectModuleNames,
  isFunction,
  keyName,
  moduleCallName,
  moduleMemberName,
  pipeReceiver,
  resolveInitializer,
  returnedExpressions,
  unwrapNode,
} from "../shared/effect-modules.ts";
import type { EffectModuleNames } from "../shared/effect-modules.ts";

type Bound = "bounded" | "unbounded" | "unknown";

const BOUNDED_SCHEDULES: ReadonlySet<string> = new Set([
  "recurs",
  "during",
  "duration",
]);
const UNBOUNDED_SCHEDULES: ReadonlySet<string> = new Set([
  "spaced",
  "exponential",
  "fibonacci",
  "fixed",
  "cron",
  "windowed",
]);
const PRESERVING_STEPS: readonly string[] = [
  "addDelay",
  "jittered",
  "map",
  "modifyDelay",
  "passthrough",
  "setInputType",
  "tap",
];
const OPTION_BOUNDS: ReadonlySet<string> = new Set(["times", "until", "while"]);
const UP_TO_BOUNDS: ReadonlySet<string> = new Set(["times", "duration"]);

const optionsSchema: RuleOptionsSchema = [
  {
    type: "object",
    properties: { testFiles: { type: "array", items: { type: "string" } } },
    additionalProperties: false,
  },
];

const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({
        testFiles: Schema.optionalKey(Schema.Array(Schema.String)),
      })
    ),
  ])
);

const stopsWhenAnyStops = (bounds: readonly Bound[]): Bound => {
  if (bounds.includes("bounded")) {
    return "bounded";
  }
  return bounds.includes("unknown") ? "unknown" : "unbounded";
};

const stopsWhenAllStop = (bounds: readonly Bound[]): Bound => {
  if (bounds.includes("unbounded")) {
    return "unbounded";
  }
  return bounds.includes("unknown") ? "unknown" : "bounded";
};

interface Analysis {
  readonly names: EffectModuleNames;
  readonly sourceCode: SourceCode;
  readonly seen: Set<ESTree.Node>;
}

function argumentAt(
  call: ESTree.CallExpression,
  index: number
): ESTree.Node | null {
  const argument = call.arguments[index];

  return argument === undefined || argument.type === "SpreadElement"
    ? null
    : argument;
}

function boundOfOptions(
  options: ESTree.ObjectExpression,
  analysis: Analysis
): Bound {
  let bound: Bound = "unbounded";

  for (const property of options.properties) {
    if (property.type !== "Property" || property.computed) {
      return "unknown";
    }
    const name = keyName(property.key);

    if (name !== null && OPTION_BOUNDS.has(name)) {
      return "bounded";
    }
    if (name === "schedule") {
      bound = boundOf(property.value, analysis);
    }
  }

  return bound;
}

function boundOfUpToOptions(options: ESTree.Node | null): Bound {
  const node = options === null ? null : unwrapNode(options);

  if (node?.type !== "ObjectExpression") {
    return "unknown";
  }
  for (const property of node.properties) {
    if (property.type !== "Property" || property.computed) {
      return "unknown";
    }
    if (UP_TO_BOUNDS.has(keyName(property.key) ?? "")) {
      return "bounded";
    }
  }

  return "unbounded";
}

type Step = (
  self: Bound,
  operands: readonly (ESTree.Node | null)[],
  analysis: Analysis
) => Bound;

const STEPS: ReadonlyMap<string, Step> = new Map<string, Step>([
  [
    "upTo",
    (self, [options = null]) =>
      stopsWhenAnyStops([self, boundOfUpToOptions(options)]),
  ],
  [
    "concat",
    (self, [other = null], analysis) =>
      stopsWhenAllStop([self, boundOfOperand(other, analysis)]),
  ],
  ...PRESERVING_STEPS.map((name): [string, Step] => [name, (self) => self]),
]);

function boundOfOperand(
  operand: ESTree.Node | null,
  analysis: Analysis
): Bound {
  return operand === null ? "unknown" : boundOf(operand, analysis);
}

const operandsOf = (
  call: ESTree.CallExpression
): readonly (ESTree.Node | null)[] =>
  call.arguments.map((_, index) => argumentAt(call, index));

function boundOfPipeStep(
  step: ESTree.Node,
  before: Bound,
  analysis: Analysis
): Bound {
  const node = unwrapNode(step);
  const member =
    node.type === "CallExpression"
      ? moduleCallName(node, analysis.names, "Schedule")
      : moduleMemberName(node, analysis.names, "Schedule");
  const combine = STEPS.get(member ?? "");

  if (combine === undefined) {
    return "unknown";
  }
  return combine(
    before,
    node.type === "CallExpression" ? operandsOf(node) : [],
    analysis
  );
}

function boundOfPipe(
  call: ESTree.CallExpression,
  receiver: ESTree.Node,
  analysis: Analysis
): Bound {
  let bound = boundOf(receiver, analysis);

  for (const step of call.arguments) {
    bound = boundOfPipeStep(step, bound, analysis);
  }

  return bound;
}

function boundsOfArray(
  call: ESTree.CallExpression,
  analysis: Analysis
): readonly Bound[] {
  const array = argumentAt(call, 0);

  if (array?.type !== "ArrayExpression") {
    return ["unknown"];
  }
  return array.elements.map((element) =>
    element === null || element.type === "SpreadElement"
      ? "unknown"
      : boundOf(element, analysis)
  );
}

function boundOfScheduleCall(
  call: ESTree.CallExpression,
  analysis: Analysis
): Bound {
  const name = moduleCallName(call, analysis.names, "Schedule") ?? "";
  const combine = STEPS.get(name);

  if (BOUNDED_SCHEDULES.has(name)) {
    return "bounded";
  }
  if (UNBOUNDED_SCHEDULES.has(name)) {
    return "unbounded";
  }
  if (name === "max") {
    return stopsWhenAnyStops(boundsOfArray(call, analysis));
  }
  if (name === "min") {
    return stopsWhenAllStop(boundsOfArray(call, analysis));
  }
  if (combine === undefined) {
    return "unknown";
  }
  const [self = null, ...operands] = operandsOf(call);

  return combine(boundOfOperand(self, analysis), operands, analysis);
}

function boundOfIdentifier(
  identifier: ESTree.Node & { readonly name: string },
  analysis: Analysis
): Bound {
  const initializer = resolveInitializer(analysis.sourceCode, identifier);

  if (initializer === null || analysis.seen.has(initializer)) {
    return "unknown";
  }
  analysis.seen.add(initializer);

  return boundOf(initializer, analysis);
}

function boundOfMember(
  node: ESTree.MemberExpression,
  analysis: Analysis
): Bound {
  const name = moduleMemberName(node, analysis.names, "Schedule");

  if (name === "once") {
    return "bounded";
  }
  return name === "forever" ? "unbounded" : "unknown";
}

function unwrapBuilderCall(
  returned: ESTree.Node,
  builder: ESTree.ArrowFunctionExpression | ESTree.Function
): ESTree.Node | null {
  const [parameter] = builder.params;
  const node = unwrapNode(returned);

  if (
    parameter?.type !== "Identifier" ||
    node.type !== "CallExpression" ||
    node.callee.type !== "Identifier" ||
    node.callee.name !== parameter.name
  ) {
    return node;
  }
  return argumentAt(node, 0);
}

function boundOfBuilder(
  builder: ESTree.ArrowFunctionExpression | ESTree.Function,
  analysis: Analysis
): Bound {
  const [returned, ...rest] = returnedExpressions(builder);

  if (returned === undefined || rest.length > 0) {
    return "unknown";
  }
  const schedule = unwrapBuilderCall(returned, builder);

  return schedule === null ? "unknown" : boundOf(schedule, analysis);
}

function boundOf(policy: ESTree.Node, analysis: Analysis): Bound {
  const node = unwrapNode(policy);

  if (node.type === "Identifier") {
    return boundOfIdentifier(node, analysis);
  }
  if (node.type === "ObjectExpression") {
    return boundOfOptions(node, analysis);
  }
  if (node.type === "MemberExpression") {
    return boundOfMember(node, analysis);
  }
  if (node.type === "ConditionalExpression") {
    return stopsWhenAllStop([
      boundOf(node.consequent, analysis),
      boundOf(node.alternate, analysis),
    ]);
  }
  if (node.type === "CallExpression") {
    const receiver = pipeReceiver(node);

    return receiver === null
      ? boundOfScheduleCall(node, analysis)
      : boundOfPipe(node, receiver, analysis);
  }
  return isFunction(node) ? boundOfBuilder(node, analysis) : "unknown";
}

interface RetryCall {
  readonly label: string;
  readonly policy: ESTree.Node | null;
}

function retryCall(
  call: ESTree.CallExpression,
  names: EffectModuleNames
): RetryCall | null {
  const effectStep = moduleCallName(call, names, "Effect");
  const streamStep = moduleCallName(call, names, "Stream");
  const policyArgument = (dataLastArity: number) =>
    argumentAt(call, call.arguments.length > dataLastArity ? 1 : 0);

  if (effectStep === "retry") {
    return { label: "Effect.retry", policy: policyArgument(1) };
  }
  if (effectStep === "retryOrElse") {
    return { label: "Effect.retryOrElse", policy: policyArgument(2) };
  }
  if (streamStep === "retry") {
    return { label: "Stream.retry", policy: policyArgument(1) };
  }
  return null;
}

function insideRetryPolicy(
  node: ESTree.Node,
  names: EffectModuleNames
): boolean {
  let child = node;
  let parent = node.parent;

  while (parent !== null && parent !== undefined) {
    if (parent.type === "CallExpression") {
      const retry = retryCall(parent, names);

      if (retry !== null && retry.policy === child) {
        return true;
      }
    }
    child = parent;
    parent = parent.parent;
  }

  return false;
}

const importsKy = (program: ESTree.Program): boolean =>
  program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" && statement.source.value === "ky"
  );

const hasLimit = (options: ESTree.ObjectExpression): boolean =>
  options.properties.some(
    (property) =>
      property.type === "SpreadElement" ||
      property.computed ||
      keyName(property.key) === "limit"
  );

export const boundedRetryRule = defineRule({
  meta: {
    type: "problem",
    schema: optionsSchema,
    docs: {
      description:
        "Require a visible bound on every retry, and forbid `Schedule.forever` in source files.",
    },
    messages: {
      unbounded:
        "`{{call}}` has no visible bound. An unbounded retry multiplies the load on a dependency that is already failing. Fix: bound it with `times`, `until` or `while` in the options, or with `Schedule.recurs`, `Schedule.during` or `Schedule.upTo` in the schedule (ADR-0009, Bounded retries and idempotency).",
      forever:
        "`Schedule.forever` never stops. Fix: bound the schedule with `Schedule.recurs`, `Schedule.during` or `Schedule.upTo` (ADR-0009, Bounded retries and idempotency).",
      kyLimit:
        "This `ky` `retry` option has no `limit`. Fix: set `limit` so that the number of attempts is visible at the call site (ADR-0009, Bounded retries and idempotency).",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const names = collectEffectModuleNames(sourceCode.ast);
    const [option] = decodeOptions(context.options);
    const inSource = !isTestPath(context.filename, option?.testFiles);
    const checksKy = importsKy(sourceCode.ast);

    return {
      CallExpression(node) {
        const retry = retryCall(node, names);

        if (retry === null) {
          return;
        }
        const bound =
          retry.policy === null
            ? "unknown"
            : boundOf(retry.policy, { names, sourceCode, seen: new Set() });

        if (bound !== "bounded") {
          context.report({
            node,
            messageId: "unbounded",
            data: { call: retry.label },
          });
        }
      },
      MemberExpression(node) {
        if (
          inSource &&
          moduleMemberName(node, names, "Schedule") === "forever" &&
          !insideRetryPolicy(node, names)
        ) {
          context.report({ node, messageId: "forever" });
        }
      },
      Property(node) {
        const value = unwrapNode(node.value);

        if (
          checksKy &&
          !node.computed &&
          keyName(node.key) === "retry" &&
          value.type === "ObjectExpression" &&
          !hasLimit(value)
        ) {
          context.report({ node, messageId: "kyLimit" });
        }
      },
    };
  },
});
