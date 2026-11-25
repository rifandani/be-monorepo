import path from "node:path";

import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";
import { Schema } from "effect";

import {
  collectEffectModuleNames,
  isTestFile,
  moduleCallName,
  moduleMemberName,
  pipeReceiver,
  resolveInitializer,
  unwrapExpression,
} from "../shared/effect-modules.ts";
import type { EffectModuleNames } from "../shared/effect-modules.ts";

const DEFAULT_ALLOW: readonly string[] = ["apps/*/src/app/**"];

const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({
        allow: Schema.optionalKey(Schema.Array(Schema.String)),
      })
    ),
  ])
);

const normalize = (file: string): string => file.replaceAll("\\", "/");

function isAllowed(
  filename: string,
  cwd: string,
  globs: readonly string[]
): boolean {
  const absolute = normalize(filename);
  const fromCwd = normalize(path.relative(cwd, filename));

  return globs.some(
    (glob) =>
      path.matchesGlob(fromCwd, glob) ||
      path.matchesGlob(absolute, glob) ||
      path.matchesGlob(absolute, `**/${glob}`)
  );
}

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
    (member === "provide" ||
      member === "provideMerge" ||
      member.startsWith("merge"))
  ) {
    return `Layer.${member}`;
  }
  return null;
}

function lastPipeStep(node: ESTree.Node): ESTree.Node | null {
  if (pipeReceiver(node) === null || node.type !== "CallExpression") {
    return null;
  }
  const last = node.arguments.at(-1);

  return last === undefined || last.type === "SpreadElement"
    ? null
    : unwrapExpression(last);
}

function outermostProvideMerge(
  layer: ESTree.Expression,
  names: EffectModuleNames,
  sourceCode: SourceCode
): ESTree.CallExpression | null {
  let expression = unwrapExpression(layer);

  if (expression.type === "Identifier") {
    const initializer = resolveInitializer(sourceCode, expression);

    if (initializer === null || initializer.type === "FunctionDeclaration") {
      return null;
    }
    expression = unwrapExpression(initializer);
  }
  const step = lastPipeStep(expression) ?? expression;

  return step.type === "CallExpression" &&
    moduleCallName(step, names, "Layer") === "provideMerge"
    ? step
    : null;
}

function launchedProvideMerges(
  node: ESTree.CallExpression,
  names: EffectModuleNames,
  sourceCode: SourceCode
): readonly ESTree.CallExpression[] {
  if (moduleCallName(node, names, "Layer") === "launch") {
    const [layer] = node.arguments;

    if (layer === undefined || layer.type === "SpreadElement") {
      return [];
    }
    const merge = outermostProvideMerge(layer, names, sourceCode);

    return merge === null ? [] : [merge];
  }
  if (pipeReceiver(node) === null) {
    return [];
  }
  const steps = node.arguments.map((argument) =>
    argument.type === "SpreadElement" ? null : unwrapExpression(argument)
  );
  const merges: ESTree.CallExpression[] = [];

  for (const [index, step] of steps.entries()) {
    const previous = steps[index - 1];

    if (
      moduleMemberName(step, names, "Layer") === "launch" &&
      previous?.type === "CallExpression" &&
      moduleCallName(previous, names, "Layer") === "provideMerge"
    ) {
      merges.push(previous);
    }
  }

  return merges;
}

export const provideLayersAtCompositionRule = defineRule({
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { allow: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    docs: {
      description:
        "Disallow providing and merging Layers outside the app composition files, and Layer.provideMerge whose merged output is discarded.",
    },
    messages: {
      outsideComposition:
        "{{operator}} wires Layers outside the app composition. The dependency graph then spreads across the code, and two places can build the same Layer twice. Fix: export the Layer and its requirements from this module, and provide or merge it in `src/app/`.",
      mergeDiscarded:
        "`Layer.launch` discards the output that `Layer.provideMerge` keeps. Fix: use `Layer.provide`.",
    },
  },
  create(context) {
    const [options] = decodeOptions(context.options);
    const names = collectEffectModuleNames(context.sourceCode.ast);

    if (names.size === 0) {
      return {};
    }
    const checkLocation = !(
      isTestFile(context.filename) ||
      isAllowed(context.filename, context.cwd, options?.allow ?? DEFAULT_ALLOW)
    );
    const launches: ESTree.CallExpression[] = [];

    return {
      MemberExpression(node) {
        if (!checkLocation) {
          return;
        }
        const operator = compositionOperator(node, names);

        if (operator !== null) {
          context.report({
            node,
            messageId: "outsideComposition",
            data: { operator },
          });
        }
      },
      CallExpression(node) {
        launches.push(node);
      },
      "Program:exit"() {
        const reported = new Set<ESTree.Node>();

        for (const launch of launches) {
          for (const merge of launchedProvideMerges(
            launch,
            names,
            context.sourceCode
          )) {
            if (reported.has(merge)) {
              continue;
            }
            reported.add(merge);
            context.report({ node: merge.callee, messageId: "mergeDiscarded" });
          }
        }
      },
    };
  },
});
