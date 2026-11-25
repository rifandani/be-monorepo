import { defineRule } from "@oxlint/plugins";
import type { ESTree, Options, RuleOptionsSchema } from "@oxlint/plugins";
import { Schema } from "effect";

import { isAllowed } from "../shared/allow-option.ts";
import {
  collectEffectModuleNames,
  isFunction,
  isTestFile,
  moduleCallName,
  ownReturns,
  unwrapNode,
  walk,
} from "../shared/effect-modules.ts";
import type {
  EffectModuleNames,
  FunctionNode,
} from "../shared/effect-modules.ts";

const DEFAULT_RESOURCES: readonly string[] = [
  "new Pool",
  "postgres",
  "drizzle",
  "createClient",
  ".listen",
];
const DEFAULT_SOURCE_RESOURCES: readonly string[] = [
  "setInterval",
  "setTimeout",
];
const DEFAULT_TEST_FILES: readonly string[] = ["apps/*/tests/**"];
const ACQUIRE_STEPS: ReadonlySet<string> = new Set([
  "acquireRelease",
  "acquireUseRelease",
  "acquireDisposable",
]);
const GENERATOR_STEPS: ReadonlySet<string> = new Set([
  "gen",
  "fn",
  "fnUntraced",
]);
const FINALIZER_LAYER_STEPS: ReadonlySet<string> = new Set([
  "effect",
  "effectDiscard",
]);
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["globalThis"]);

const optionsSchema: RuleOptionsSchema = [
  {
    type: "object",
    properties: {
      resources: { type: "array", items: { type: "string" } },
      sourceResources: { type: "array", items: { type: "string" } },
      testFiles: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
];

const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({
        resources: Schema.optionalKey(Schema.Array(Schema.String)),
        sourceResources: Schema.optionalKey(Schema.Array(Schema.String)),
        testFiles: Schema.optionalKey(Schema.Array(Schema.String)),
      })
    ),
  ])
);

interface ResourcePattern {
  readonly kind: "construct" | "method" | "function";
  readonly name: string;
  readonly label: string;
}

function parsePattern(label: string): ResourcePattern {
  if (label.startsWith("new ")) {
    return { kind: "construct", name: label.slice("new ".length), label };
  }
  if (label.startsWith(".")) {
    return { kind: "method", name: label.slice(1), label };
  }
  return { kind: "function", name: label, label };
}

function patternsFor(
  options: Readonly<Options>,
  filename: string
): readonly ResourcePattern[] {
  const [option] = decodeOptions(options);
  const resources = option?.resources ?? DEFAULT_RESOURCES;
  const inTests =
    isTestFile(filename) ||
    isAllowed(filename, option?.testFiles ?? DEFAULT_TEST_FILES);
  const labels = inTests
    ? resources
    : [...resources, ...(option?.sourceResources ?? DEFAULT_SOURCE_RESOURCES)];

  return labels.map(parsePattern);
}

const propertyName = (node: ESTree.Node): string | null =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.property.type === "Identifier"
    ? node.property.name
    : null;

function matches(node: ESTree.Node, pattern: ResourcePattern): boolean {
  if (pattern.kind === "construct") {
    if (node.type !== "NewExpression") {
      return false;
    }
    const callee = unwrapNode(node.callee);

    return (
      (callee.type === "Identifier" ? callee.name : propertyName(callee)) ===
      pattern.name
    );
  }
  if (node.type !== "CallExpression") {
    return false;
  }
  const callee = unwrapNode(node.callee);

  if (pattern.kind === "method") {
    return propertyName(callee) === pattern.name;
  }
  if (callee.type === "Identifier") {
    return callee.name === pattern.name;
  }
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    GLOBAL_OBJECTS.has(callee.object.name) &&
    propertyName(callee) === pattern.name
  );
}

function generatorOf(
  call: ESTree.CallExpression,
  names: EffectModuleNames
): ESTree.Function | null {
  const callee = unwrapNode(call.callee);
  const step =
    moduleCallName(call, names, "Effect") ??
    (callee.type === "CallExpression"
      ? moduleCallName(callee, names, "Effect")
      : null);

  if (step === null || !GENERATOR_STEPS.has(step)) {
    return null;
  }
  return (
    call.arguments.find(
      (argument): argument is ESTree.Function =>
        argument.type === "FunctionExpression" && argument.generator
    ) ?? null
  );
}

function addsFinalizer(root: ESTree.Node, names: EffectModuleNames): boolean {
  let found = false;
  walk(root, (node) => {
    if (found || (node !== root && isFunction(node) && node.generator)) {
      return false;
    }
    found = moduleCallName(node, names, "Effect") === "addFinalizer";
    return !found;
  });

  return found;
}

const returnsCleanup = (callback: ESTree.Node | undefined): boolean =>
  callback !== undefined &&
  isFunction(callback) &&
  callback.body?.type === "BlockStatement" &&
  ownReturns(callback.body).some((statement) => statement.argument !== null);

function ownsScope(
  call: ESTree.CallExpression,
  child: ESTree.Node,
  names: EffectModuleNames
): boolean {
  const effectStep = moduleCallName(call, names, "Effect");
  const [first] = call.arguments;

  if (effectStep !== null && ACQUIRE_STEPS.has(effectStep)) {
    return child === first;
  }
  if (effectStep === "callback") {
    return child === first && returnsCleanup(first);
  }
  const generator = generatorOf(call, names);

  if (generator !== null) {
    return child === generator && addsFinalizer(generator, names);
  }
  const layerStep = moduleCallName(call, names, "Layer");

  return (
    (effectStep === "scoped" ||
      (layerStep !== null && FINALIZER_LAYER_STEPS.has(layerStep))) &&
    addsFinalizer(call, names)
  );
}

const runsInline = (fn: FunctionNode): boolean =>
  (fn.parent?.type === "CallExpression" ||
    fn.parent?.type === "NewExpression") &&
  fn.parent.arguments.some((argument) => argument === fn);

function insideScope(node: ESTree.Node, names: EffectModuleNames): boolean {
  let child = node;
  let parent = node.parent;

  while (parent !== null && parent !== undefined) {
    if (isFunction(child) && !runsInline(child)) {
      return false;
    }
    if (parent.type === "CallExpression" && ownsScope(parent, child, names)) {
      return true;
    }
    child = parent;
    parent = parent.parent;
  }

  return false;
}

export const requireScopedResourceRule = defineRule({
  meta: {
    type: "problem",
    schema: optionsSchema,
    docs: {
      description:
        "Require pools, clients, servers and timers to be acquired inside a scope that releases them.",
    },
    messages: {
      unscoped:
        "`{{resource}}` makes a resource outside a scope. It does not close on failure or interruption, so it leaks in tests and slows shutdown. Fix: acquire it lazily inside its owner Layer with `Effect.acquireRelease` (or `Effect.acquireUseRelease`), or in the `Layer.effect` body next to an `Effect.addFinalizer` that releases it.",
    },
  },
  create(context) {
    const names = collectEffectModuleNames(context.sourceCode.ast);
    const patterns = patternsFor(context.options, context.filename);

    const check = (node: ESTree.CallExpression | ESTree.NewExpression) => {
      const pattern = patterns.find((candidate) => matches(node, candidate));

      if (pattern !== undefined && !insideScope(node, names)) {
        context.report({
          node,
          messageId: "unscoped",
          data: { resource: pattern.label },
        });
      }
    };

    return { CallExpression: check, NewExpression: check };
  },
});
