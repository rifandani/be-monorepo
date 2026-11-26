import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
  allowOptionSchema,
  decodeAllowOption,
  isAllowed,
} from "../../anti-slop-effect/shared/allow-option.ts";
import { definition, memberName, propertyName } from "../syntax.ts";

const ENV = "env";

type NamedNode = ESTree.Node & { readonly name: string };

const HOST_GLOBALS = new Set(["process", "Bun", "Deno"]);

const HOST_MODULES = new Set(["node:process", "process", "bun"]);

const isUnshadowedGlobal = (source: SourceCode, node: NamedNode) =>
  definition(source, node) === undefined;

const isHostImport = (source: SourceCode, node: NamedNode) => {
  const binding = definition(source, node);
  const declaration = binding?.parent;

  return (
    binding?.type === "ImportBinding" &&
    declaration?.type === "ImportDeclaration" &&
    declaration.importKind !== "type" &&
    HOST_MODULES.has(declaration.source.value) &&
    (binding.node.type === "ImportDefaultSpecifier" ||
      binding.node.type === "ImportNamespaceSpecifier")
  );
};

const isEnvHost = (source: SourceCode, node: ESTree.Node): boolean => {
  if (node.type === "Identifier") {
    return (
      (HOST_GLOBALS.has(node.name) && isUnshadowedGlobal(source, node)) ||
      isHostImport(source, node)
    );
  }

  return (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === "globalThis" &&
    isUnshadowedGlobal(source, node.object) &&
    HOST_GLOBALS.has(memberName(node) ?? "")
  );
};

const isImportMeta = (node: ESTree.Node) =>
  node.type === "MetaProperty" &&
  node.meta.name === "import" &&
  node.property.name === "meta";

const destructuresEnv = (pattern: ESTree.Node) =>
  pattern.type === "ObjectPattern" &&
  pattern.properties.some(
    (property) =>
      property.type === "Property" && propertyName(property.key) === ENV
  );

export const noAmbientEnv = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow reading the environment (`process.env`, `Bun.env`, `Deno.env`, `import.meta.env`) outside the config modules.",
    },
    messages: {
      ambientEnv:
        "This code reads the environment directly. A setting read here cannot be supplied by a test, and it skips the validation of the config module. Fix: add the setting to the config module (`apps/hono/src/shared/constants/env.ts` or `apps/effect/src/shared/config.ts`) and read it from there, or pass it in as a parameter.",
    },
    schema: allowOptionSchema,
  },
  create(context) {
    if (isAllowed(context.filename, decodeAllowOption(context.options) ?? [])) {
      return {};
    }

    const source = context.sourceCode;

    return {
      MemberExpression(node) {
        if (
          memberName(node) === ENV &&
          (isImportMeta(node.object) || isEnvHost(source, node.object))
        ) {
          context.report({ messageId: "ambientEnv", node });
        }
      },
      VariableDeclarator(node) {
        if (
          node.init !== null &&
          destructuresEnv(node.id) &&
          isEnvHost(source, node.init)
        ) {
          context.report({ messageId: "ambientEnv", node });
        }
      },
      ImportSpecifier(node) {
        if (
          node.importKind !== "type" &&
          node.parent.type === "ImportDeclaration" &&
          HOST_MODULES.has(node.parent.source.value) &&
          propertyName(node.imported) === ENV
        ) {
          context.report({ messageId: "ambientEnv", node });
        }
      },
    };
  },
});
