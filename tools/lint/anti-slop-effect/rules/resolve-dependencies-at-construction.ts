import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
  collectEffectModuleNames,
  isFunction,
  isTestFile,
  keyName,
  makeGenerator,
  moduleCallName,
  moduleMemberName,
  resolveIdentifier,
  resolveInitializer,
  returnedObjects,
  serviceClass,
  serviceMakes,
  unwrapExpression,
  unwrapNode,
  walk,
} from "../shared/effect-modules.ts";
import type {
  EffectModuleNames,
  FunctionNode,
} from "../shared/effect-modules.ts";

const SERVICE_NAME = /^[A-Z]/u;
const EFFECT_PACKAGE = /^(?:effect|effect\/.+|@effect\/.+)$/u;
const LAYER_CONSTRUCTORS: ReadonlySet<string> = new Set(["effect", "scoped"]);
const EFFECT_SERVICE_MAKES: ReadonlySet<string> = new Set([
  "effect",
  "make",
  "scoped",
]);

function effectServiceMakes(
  node: ESTree.Class,
  names: EffectModuleNames
): readonly ESTree.Expression[] | null {
  if (node.superClass === null) {
    return null;
  }
  const superClass = unwrapExpression(node.superClass);

  if (superClass.type !== "CallExpression") {
    return null;
  }
  const factory = unwrapExpression(superClass.callee);

  if (
    factory.type !== "CallExpression" ||
    moduleMemberName(unwrapExpression(factory.callee), names, "Effect") !==
      "Service"
  ) {
    return null;
  }
  const options = superClass.arguments[1];

  if (options === undefined || options.type === "SpreadElement") {
    return [];
  }
  const object = unwrapExpression(options);

  if (object.type !== "ObjectExpression") {
    return [];
  }
  return object.properties.flatMap((property) =>
    property.type === "Property" &&
    !property.computed &&
    EFFECT_SERVICE_MAKES.has(keyName(property.key) ?? "")
      ? [property.value]
      : []
  );
}

const isServiceClassNode = (
  node: ESTree.Node,
  names: EffectModuleNames
): boolean =>
  (node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
  (serviceClass(node, names) !== null ||
    effectServiceMakes(node, names) !== null);

function serviceTagName(
  argument: ESTree.Node,
  names: EffectModuleNames,
  sourceCode: SourceCode
): string | null {
  const expression = unwrapNode(argument);

  if (expression.type !== "Identifier" || !SERVICE_NAME.test(expression.name)) {
    return null;
  }
  const variable = resolveIdentifier(sourceCode, expression);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : null;

  if (definition === null || definition === undefined) {
    return null;
  }
  if (definition.type === "ClassName") {
    return isServiceClassNode(definition.node, names) ? expression.name : null;
  }
  if (
    definition.type !== "ImportBinding" ||
    definition.node.type === "ImportNamespaceSpecifier" ||
    definition.parent?.type !== "ImportDeclaration" ||
    EFFECT_PACKAGE.test(definition.parent.source.value)
  ) {
    return null;
  }
  return expression.name;
}

function enclosingFunction(node: ESTree.Node): ESTree.Node | null {
  let current = node.parent;

  while (current !== null && current !== undefined) {
    if (isFunction(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

const variableName = (dependency: string): string =>
  `${dependency.charAt(0).toLowerCase()}${dependency.slice(1)}`;

export const resolveDependenciesAtConstructionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a service make to resolve the services it depends on at construction, not inside the methods it returns.",
    },
    messages: {
      lateDependency:
        'A service method yields "{{dependency}}" inside its body. Every caller must then supply "{{dependency}}", and the dependency graph is hidden. Fix: resolve it once at the top of `make` with `const {{variable}} = yield* {{dependency}}`, and use that value in the method.',
    },
  },
  create(context) {
    if (isTestFile(context.filename)) {
      return {};
    }
    const names = collectEffectModuleNames(context.sourceCode.ast);
    const { sourceCode } = context;
    const reported = new Set<ESTree.Node>();

    const runsAtConstruction = (
      node: ESTree.Node,
      construction: FunctionNode | null
    ): boolean =>
      node.type === "YieldExpression" &&
      enclosingFunction(node) === construction;

    const reportLateYields = (
      method: ESTree.Node,
      construction: FunctionNode | null
    ) => {
      walk(method, (node) => {
        if (runsAtConstruction(node, construction)) {
          return false;
        }
        if (
          node.type !== "YieldExpression" ||
          !node.delegate ||
          node.argument === null ||
          reported.has(node)
        ) {
          return true;
        }
        const dependency = serviceTagName(node.argument, names, sourceCode);

        if (dependency !== null) {
          reported.add(node);
          context.report({
            node,
            messageId: "lateDependency",
            data: { dependency, variable: variableName(dependency) },
          });
        }
        return true;
      });
    };

    const methodBody = (value: ESTree.Node): ESTree.Node | null => {
      const expression = unwrapNode(value);

      return expression.type === "Identifier"
        ? resolveInitializer(sourceCode, expression)
        : expression;
    };

    const checkMethods = (
      make: FunctionNode,
      construction: FunctionNode | null
    ) => {
      for (const object of returnedObjects(make, sourceCode)) {
        for (const property of object.properties) {
          const body =
            property.type === "Property" ? methodBody(property.value) : null;

          if (body !== null) {
            reportLateYields(body, construction);
          }
        }
      }
    };

    const checkMake = (make: ESTree.Expression) => {
      const expression = unwrapExpression(make);
      const resolved =
        expression.type === "Identifier"
          ? resolveInitializer(sourceCode, expression)
          : expression;

      if (resolved === null) {
        return;
      }
      if (resolved.type === "FunctionDeclaration") {
        checkMethods(resolved, null);
        return;
      }
      const generator = makeGenerator(resolved, names);

      if (generator !== null) {
        checkMethods(generator, generator);
      } else if (isFunction(resolved)) {
        checkMethods(resolved, null);
      }
    };

    const checkClass = (node: ESTree.Class) => {
      const service = serviceClass(node, names);
      const makes =
        service === null
          ? (effectServiceMakes(node, names) ?? [])
          : serviceMakes(service);

      for (const make of makes) {
        checkMake(make);
      }
    };

    const isLayerConstructor = (node: ESTree.Node): boolean =>
      LAYER_CONSTRUCTORS.has(moduleCallName(node, names, "Layer") ?? "");

    return {
      ClassDeclaration: checkClass,
      ClassExpression: checkClass,
      CallExpression(node) {
        const callee = unwrapNode(node.callee);

        if (!isLayerConstructor(node) && !isLayerConstructor(callee)) {
          return;
        }
        for (const argument of node.arguments) {
          if (argument.type !== "SpreadElement") {
            checkMake(argument);
          }
        }
      },
    };
  },
});
