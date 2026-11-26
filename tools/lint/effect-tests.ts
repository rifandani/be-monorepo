import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import { imported, vitest } from "./landmines/syntax.ts";

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const EFFECT_RUNTIME_METHODS = new Set([
  "runCallback",
  "runCallbackWith",
  "runFork",
  "runForkWith",
  "runPromise",
  "runPromiseExit",
  "runPromiseExitWith",
  "runPromiseWith",
  "runSync",
  "runSyncExit",
  "runSyncExitWith",
  "runSyncWith",
]);

const manualRunnerName = (callee: ESTree.Node): string | undefined => {
  if (
    callee.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    callee.property.type !== "Identifier"
  ) {
    return undefined;
  }

  const object = callee.object.name;
  const method = callee.property.name;

  if (object === "Effect" && EFFECT_RUNTIME_METHODS.has(method)) {
    return `Effect.${method}`;
  }

  if (object === "ManagedRuntime" && method === "make") {
    return "ManagedRuntime.make";
  }

  return undefined;
};

export const noManualEffectRuntimeInTests = defineRule({
  create(context) {
    if (!TEST_FILE_PATTERN.test(context.filename)) {
      return {};
    }

    return {
      CallExpression(node) {
        if (manualRunnerName(node.callee) !== undefined) {
          context.report({ messageId: "manualRunner", node: node.callee });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow manually creating or running Effect runtimes in tests; use @effect/vitest.",
    },
    messages: {
      manualRunner:
        "Tests cannot run Effects by hand. Effect.run* and ManagedRuntime.make skip the test runtime's scope, clock, and layer cleanup. Fix: write the test with `it.effect(...)` or `it.layer(layer)(...)` from `@effect/vitest`.",
    },
    type: "problem",
  },
});

const TEST_DIRECTORY_PATTERN = /(?:^|\/)tests\//u;

const MODULE_MOCKS = new Set(["mock", "doMock"]);

const SERVICE_MODULES = new Set(["Context", "Layer"]);

const SERVICE_SUPPLIERS = new Set([
  "Effect.provideService",
  "Effect.provideServiceEffect",
]);

const NETWORK_HANDLERS = new Set(["http", "graphql", "ws"]);

const vitestMethod = (source: SourceCode, callee: ESTree.Node) => {
  const ref = imported(source, callee, false);

  const [framework, method, ...rest] =
    ref !== undefined && vitest.includes(ref.from) ? ref.names : [];

  return framework === "vi" && rest.length === 0 ? method : undefined;
};

const rootCallee = (node: ESTree.Node): ESTree.Node =>
  node.type === "CallExpression" ? rootCallee(node.callee) : node;

const EFFECT_SUBPATH = "effect/";

const effectPath = (source: SourceCode, callee: ESTree.Node) => {
  const ref = imported(source, callee, false);

  const from = ref?.from ?? "";
  const names = ref?.names ?? [];

  if (from === "effect") {
    return names;
  }

  return from.startsWith(EFFECT_SUBPATH)
    ? [from.slice(EFFECT_SUBPATH.length), ...names]
    : [];
};

const providesProgram = (call: ESTree.CallExpression, child: ESTree.Node) =>
  call.arguments.length > 2 && call.arguments[0] === child;

const suppliesService = (
  source: SourceCode,
  call: ESTree.CallExpression,
  child: ESTree.Node
) => {
  const callee = rootCallee(call.callee);

  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "of"
  ) {
    return true;
  }

  const [module, method, ...rest] = effectPath(source, callee);

  if (module === undefined || method === undefined || rest.length > 0) {
    return false;
  }

  if (module === "Effect") {
    return (
      SERVICE_SUPPLIERS.has(`${module}.${method}`) &&
      !providesProgram(call, child)
    );
  }

  return SERVICE_MODULES.has(module);
};

const handlesNetwork = (source: SourceCode, call: ESTree.CallExpression) => {
  const ref = imported(source, call.callee, false);

  return (
    ref !== undefined &&
    ref.from === "msw" &&
    NETWORK_HANDLERS.has(ref.names[0] ?? "")
  );
};

const replacesService = (source: SourceCode, node: ESTree.Node) => {
  let child: ESTree.Node = node;

  for (
    let current = node.parent;
    current !== null && current !== undefined;
    current = current.parent
  ) {
    if (current.type === "CallExpression") {
      if (handlesNetwork(source, current)) {
        return false;
      }

      if (suppliesService(source, current, child)) {
        return true;
      }
    }

    child = current;
  }

  return false;
};

const VALUE_WRAPPERS = new Set([
  "ArrayExpression",
  "ObjectExpression",
  "Property",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);

const MAX_BINDING_DEPTH = 4;

const declaratorOf = (node: ESTree.Node): ESTree.VariableDeclarator | null => {
  let child: ESTree.Node = node;
  let current = node.parent;

  while (
    current !== null &&
    current !== undefined &&
    VALUE_WRAPPERS.has(current.type) &&
    (current.type !== "Property" || current.value === child)
  ) {
    child = current;
    current = current.parent;
  }

  return current?.type === "VariableDeclarator" && current.init === child
    ? current
    : null;
};

const boundIntoService = (
  source: SourceCode,
  node: ESTree.Node,
  depth: number
): boolean => {
  const declarator = declaratorOf(node);

  if (declarator === null || depth > MAX_BINDING_DEPTH) {
    return false;
  }

  return source
    .getDeclaredVariables(declarator)
    .some((variable) =>
      variable.references.some(
        ({ identifier }) =>
          identifier !== declarator.id &&
          (replacesService(source, identifier) ||
            boundIntoService(source, identifier, depth + 1))
      )
    );
};

const spiesOnConsole = (node: ESTree.CallExpression) => {
  const [target] = node.arguments;

  return target?.type === "Identifier" && target.name === "console";
};

export const supplyServicesThroughLayers = defineRule({
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");

    if (
      !TEST_FILE_PATTERN.test(filename) &&
      !TEST_DIRECTORY_PATTERN.test(filename)
    ) {
      return {};
    }

    const source = context.sourceCode;

    return {
      CallExpression(node) {
        const method = vitestMethod(source, node.callee);

        if (method !== undefined && MODULE_MOCKS.has(method)) {
          context.report({ messageId: "moduleMock", node: node.callee });
        } else if (method === "spyOn" && !spiesOnConsole(node)) {
          context.report({ messageId: "spy", node: node.callee });
        } else if (
          method === "fn" &&
          (replacesService(source, node) || boundIntoService(source, node, 0))
        ) {
          context.report({ messageId: "serviceFn", node: node.callee });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Require Effect tests to supply services through test Layers instead of module mocks, spies, and vi.fn stand-ins; MSW at the network boundary stays allowed.",
    },
    messages: {
      moduleMock:
        "Effect tests cannot replace modules. vi.mock and vi.doMock fake at the module boundary, so the real service wiring never runs and the test keeps passing when it breaks. Fix: provide a test implementation with `Layer.succeed(Service)(...)` or `it.layer(layer)(...)`, or fake HTTP at the network boundary with MSW (ADR-0001).",
      serviceFn:
        "Effect tests cannot build services out of vi.fn. A vi.fn stand-in records calls instead of behaving like the service, so the test cannot detect breakage. Fix: give the test Layer a small real implementation (an in-memory adapter) and assert on observable results.",
      spy: "Effect tests cannot spy on collaborators. vi.spyOn replaces a dependency in place instead of supplying it through the environment. Fix: provide a test Layer for the service, or fake HTTP at the network boundary with MSW (ADR-0001); `vi.spyOn(console, ...)` stays allowed.",
    },
    type: "problem",
  },
});

export default definePlugin({
  meta: { name: "effect-tests" },
  rules: {
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests,
    "supply-services-through-layers": supplyServicesThroughLayers,
  },
});
