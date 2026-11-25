import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
  allowOptionSchema,
  decodeAllowOption,
  isAllowed,
} from "../shared/allow-option.ts";
import {
  collectEffectModuleNames,
  isTestFile,
  moduleCallName,
  moduleMemberName,
  pipeReceiver,
  resolveIdentifier,
  unwrapExpression,
} from "../shared/effect-modules.ts";
import type { EffectModuleNames } from "../shared/effect-modules.ts";

const DEFAULT_ALLOW: readonly string[] = [
  "apps/*/src/app/**",
  "apps/*/tests/**",
];
const OUTPUT_PRESERVING_STEPS: ReadonlySet<string> = new Set([
  "provide",
  "provideMerge",
]);

function compositionOperator(
  node: ESTree.Node,
  names: EffectModuleNames
): string | null {
  if (moduleMemberName(node, names, "Effect") === "provide") {
    return "Effect.provide";
  }
  const member = moduleMemberName(node, names, "Layer");

  if (
    member !== null &&
    (OUTPUT_PRESERVING_STEPS.has(member) || member.startsWith("merge"))
  ) {
    return `Layer.${member}`;
  }
  return null;
}

function privateSingleUseConst(
  identifier: ESTree.IdentifierReference,
  sourceCode: SourceCode
): ESTree.Expression | null {
  const variable = resolveIdentifier(sourceCode, identifier);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : null;

  if (
    variable === null ||
    definition?.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    definition.parent?.type !== "VariableDeclaration" ||
    definition.parent.kind !== "const" ||
    definition.parent.parent.type === "ExportNamedDeclaration" ||
    variable.references.filter((reference) => reference.isRead()).length !== 1
  ) {
    return null;
  }
  return definition.node.init ?? null;
}

const expressionArguments = (
  call: ESTree.CallExpression
): readonly ESTree.Expression[] =>
  call.arguments.flatMap((argument) =>
    argument.type === "SpreadElement" ? [] : [unwrapExpression(argument)]
  );

function discardedProvideMerges(
  layer: ESTree.Expression,
  names: EffectModuleNames,
  sourceCode: SourceCode
): readonly ESTree.CallExpression[] {
  const expression = unwrapExpression(layer);

  if (expression.type === "Identifier") {
    const initializer = privateSingleUseConst(expression, sourceCode);

    return initializer === null
      ? []
      : discardedProvideMerges(initializer, names, sourceCode);
  }
  if (expression.type !== "CallExpression") {
    return [];
  }
  const receiver = pipeReceiver(expression);

  if (receiver !== null) {
    return discardedThroughSteps(
      receiver,
      expressionArguments(expression),
      names,
      sourceCode
    );
  }
  const member = moduleCallName(expression, names, "Layer");
  const [self, ...rest] = expressionArguments(expression);

  if (member === null || self === undefined) {
    return [];
  }
  if (member.startsWith("merge")) {
    return [self, ...rest].flatMap((merged) =>
      discardedProvideMerges(merged, names, sourceCode)
    );
  }
  if (!OUTPUT_PRESERVING_STEPS.has(member) || rest.length === 0) {
    return [];
  }
  const inner = discardedProvideMerges(self, names, sourceCode);

  return member === "provideMerge" ? [expression, ...inner] : inner;
}

function discardedThroughSteps(
  receiver: ESTree.Expression,
  steps: readonly ESTree.Expression[],
  names: EffectModuleNames,
  sourceCode: SourceCode
): readonly ESTree.CallExpression[] {
  const merges: ESTree.CallExpression[] = [];

  for (const step of steps) {
    const member =
      step.type === "CallExpression"
        ? moduleCallName(step, names, "Layer")
        : null;

    if (
      step.type !== "CallExpression" ||
      member === null ||
      !(OUTPUT_PRESERVING_STEPS.has(member) || member.startsWith("merge"))
    ) {
      return [];
    }
    if (member === "provideMerge") {
      merges.push(step);
    }
  }

  return [...discardedProvideMerges(receiver, names, sourceCode), ...merges];
}

function launchedProvideMerges(
  node: ESTree.CallExpression,
  names: EffectModuleNames,
  sourceCode: SourceCode
): readonly ESTree.CallExpression[] {
  if (moduleCallName(node, names, "Layer") === "launch") {
    const [layer] = expressionArguments(node);

    return layer === undefined
      ? []
      : discardedProvideMerges(layer, names, sourceCode);
  }
  const receiver = pipeReceiver(node);
  const steps = expressionArguments(node);
  const launch = steps.findIndex(
    (step) => moduleMemberName(step, names, "Layer") === "launch"
  );

  return receiver === null || launch === -1
    ? []
    : discardedThroughSteps(
        receiver,
        steps.slice(0, launch),
        names,
        sourceCode
      );
}

export const provideLayersAtCompositionRule = defineRule({
  meta: {
    type: "problem",
    schema: allowOptionSchema,
    docs: {
      description:
        "Disallow providing and merging Layers outside the app composition files, and Layer.provideMerge whose merged output Layer.launch discards.",
    },
    messages: {
      outsideComposition:
        "{{operator}} wires Layers outside the app composition files. The dependency graph then spreads across the code, and two places can build the same Layer twice. Fix: export the Layer and its requirements from this module, and provide or merge it in a composition file (the `allow` option, by default `apps/*/src/app/**`).",
      mergeDiscarded:
        "`Layer.launch` discards the output that `Layer.provideMerge` keeps. Fix: use `Layer.provide`.",
    },
  },
  create(context) {
    const names = collectEffectModuleNames(context.sourceCode.ast);

    if (names.size === 0) {
      return {};
    }
    const outsideComposition = !(
      isTestFile(context.filename) ||
      isAllowed(
        context.filename,
        decodeAllowOption(context.options) ?? DEFAULT_ALLOW
      )
    );

    return {
      MemberExpression(node) {
        const operator = outsideComposition
          ? compositionOperator(node, names)
          : null;

        if (operator !== null) {
          context.report({
            node,
            messageId: "outsideComposition",
            data: { operator },
          });
        }
      },
      CallExpression(node) {
        for (const merge of launchedProvideMerges(
          node,
          names,
          context.sourceCode
        )) {
          context.report({ node: merge.callee, messageId: "mergeDiscarded" });
        }
      },
    };
  },
});
