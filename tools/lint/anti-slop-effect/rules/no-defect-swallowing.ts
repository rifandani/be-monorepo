import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";
import { Schema } from "effect";

import {
  collectEffectModuleNames,
  genFunction,
  isFunction,
  moduleCallName,
  moduleMemberName,
  ownReturns,
  pipeReceiver,
  resolveInitializer,
  returnedExpressions,
  unwrapNode,
} from "../shared/effect-modules.ts";
import type {
  EffectModuleNames,
  FunctionNode,
} from "../shared/effect-modules.ts";

const alwaysSucceeds: ReadonlySet<string> = new Set([
  "ignore",
  "ignoreCause",
  "orElseSucceed",
]);

const broadHandlers: ReadonlySet<string> = new Set([
  "catch",
  "catchAll",
  "catchCause",
  "catchDefect",
]);

const successConstructors: ReadonlySet<string> = new Set([
  "as",
  "asSome",
  "asVoid",
  "promise",
  "succeed",
  "succeedNone",
  "succeedSome",
  "sync",
]);

const successValues: ReadonlySet<string> = new Set(["void", "asVoid"]);

const isLogCall = (member: string): boolean => /^log(?:[A-Z]|$)/u.test(member);

const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({
        allow: Schema.optionalKey(Schema.Array(Schema.String)),
      })
    ),
  ])
);

function isFailure(node: ESTree.Node, names: EffectModuleNames): boolean {
  const expression = unwrapNode(node);

  if (expression.type === "NewExpression") {
    return true;
  }
  const member = moduleCallName(expression, names, "Effect");

  return (
    member !== null &&
    /^(?:fail|die|interrupt)/u.test(member) &&
    member !== "failFast"
  );
}

function generatorSucceeds(
  generator: ESTree.Function,
  names: EffectModuleNames,
  sourceCode: SourceCode
): boolean {
  if (generator.body === null) {
    return false;
  }
  const returns = ownReturns(generator.body);

  if (returns.length === 0) {
    const last = generator.body.body.at(-1);

    if (last?.type !== "ExpressionStatement") {
      return true;
    }
    const expression = unwrapNode(last.expression);

    return !(
      expression.type === "YieldExpression" &&
      expression.argument !== null &&
      isFailure(expression.argument, names)
    );
  }
  return returns.some((statement) => {
    if (statement.argument === null) {
      return true;
    }
    const argument = unwrapNode(statement.argument);

    if (argument.type !== "YieldExpression") {
      return true;
    }
    return (
      argument.argument !== null &&
      succeeds(argument.argument, names, sourceCode)
    );
  });
}

function lastPipeStepSucceeds(
  expression: ESTree.Node,
  names: EffectModuleNames
): boolean {
  if (
    pipeReceiver(expression) === null ||
    expression.type !== "CallExpression"
  ) {
    return false;
  }
  const last = expression.arguments.at(-1);

  if (last === undefined) {
    return false;
  }
  const step = unwrapNode(last);

  return (
    successValues.has(moduleMemberName(step, names, "Effect") ?? "") ||
    successConstructors.has(moduleCallName(step, names, "Effect") ?? "")
  );
}

function succeeds(
  node: ESTree.Node,
  names: EffectModuleNames,
  sourceCode: SourceCode
): boolean {
  const expression = unwrapNode(node);

  if (expression.type === "ConditionalExpression") {
    return (
      succeeds(expression.consequent, names, sourceCode) ||
      succeeds(expression.alternate, names, sourceCode)
    );
  }
  if (expression.type === "LogicalExpression") {
    return (
      succeeds(expression.left, names, sourceCode) ||
      succeeds(expression.right, names, sourceCode)
    );
  }
  if (successValues.has(moduleMemberName(expression, names, "Effect") ?? "")) {
    return true;
  }
  const member = moduleCallName(expression, names, "Effect");

  if (
    member === "as" &&
    expression.type === "CallExpression" &&
    expression.arguments.length > 1
  ) {
    const [source] = expression.arguments;

    return source !== undefined && !isFailure(source, names);
  }
  if (
    member !== null &&
    (successConstructors.has(member) || isLogCall(member))
  ) {
    return true;
  }
  if (
    (member === "andThen" || member === "flatMap") &&
    expression.type === "CallExpression"
  ) {
    const next = expression.arguments.at(-1);

    return next !== undefined && succeeds(next, names, sourceCode);
  }
  if (isFunction(expression)) {
    return handlerSucceeds(expression, names, sourceCode);
  }
  const generator = genFunction(expression, names);

  if (generator !== null) {
    return generatorSucceeds(generator, names, sourceCode);
  }
  return lastPipeStepSucceeds(expression, names);
}

function fnGenerator(
  node: ESTree.Node,
  names: EffectModuleNames
): ESTree.Function | null {
  if (node.type !== "CallExpression") {
    return null;
  }
  const factory = unwrapNode(node.callee);

  if (moduleCallName(factory, names, "Effect") !== "fn") {
    return null;
  }
  const body = node.arguments[0];

  return body?.type === "FunctionExpression" && body.generator ? body : null;
}

function handlerSucceeds(
  handler: FunctionNode,
  names: EffectModuleNames,
  sourceCode: SourceCode
): boolean {
  if (handler.type !== "ArrowFunctionExpression" && handler.generator) {
    return generatorSucceeds(handler, names, sourceCode);
  }
  return returnedExpressions(handler).some((returned) =>
    succeeds(returned, names, sourceCode)
  );
}

function resolvedHandlerSucceeds(
  node: ESTree.Node,
  names: EffectModuleNames,
  sourceCode: SourceCode
): boolean {
  const handler = unwrapNode(node);

  if (isFunction(handler)) {
    return handlerSucceeds(handler, names, sourceCode);
  }
  if (handler.type !== "Identifier") {
    return false;
  }
  const initializer = resolveInitializer(sourceCode, handler);

  if (initializer === null) {
    return false;
  }
  if (isFunction(initializer)) {
    return handlerSucceeds(initializer, names, sourceCode);
  }
  const generator = fnGenerator(unwrapNode(initializer), names);

  return generator !== null && generatorSucceeds(generator, names, sourceCode);
}

const normalize = (path: string): string => path.replaceAll("\\", "/");

export const noDefectSwallowingRule = defineRule({
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
        "Disallow broad Effect recovery that turns a failure or a defect into a success outside the error boundary files.",
    },
    messages: {
      swallowed:
        "{{operator}} turns a failure into a success. A refusal, an infrastructure fault and a defect then look the same as a good result. Fix: recover from named errors with `Effect.catchTag` or `Effect.catchTags`, fail again after you log, or move the recovery into an error boundary file.",
    },
  },
  create(context) {
    const [options] = decodeOptions(context.options);
    const filename = normalize(context.filename);

    if (
      (options?.allow ?? []).some((path) => filename.endsWith(normalize(path)))
    ) {
      return {};
    }
    const names = collectEffectModuleNames(context.sourceCode.ast);

    const report = (node: ESTree.Node, operator: string) => {
      context.report({
        node,
        messageId: "swallowed",
        data: { operator: `Effect.${operator}` },
      });
    };

    return {
      MemberExpression(node) {
        const operator = moduleMemberName(node, names, "Effect");

        if (operator === null || !alwaysSucceeds.has(operator)) {
          return;
        }
        if (
          node.parent.type === "CallExpression" &&
          node.parent.callee === node
        ) {
          report(node.parent, operator);

          return;
        }
        report(node, operator);
      },
      CallExpression(node) {
        const operator = moduleCallName(node, names, "Effect");

        if (operator === null || !broadHandlers.has(operator)) {
          return;
        }
        const handler = node.arguments.at(-1);

        if (
          handler !== undefined &&
          resolvedHandlerSucceeds(handler, names, context.sourceCode)
        ) {
          report(node, operator);
        }
      },
    };
  },
});
