import { defineRule } from "@oxlint/plugins";
import type {
  ESTree,
  Options,
  RuleOptionsSchema,
  SourceCode,
} from "@oxlint/plugins";
import { Schema } from "effect";

import { isAllowed } from "../../anti-slop-effect/shared/allow-option.ts";
import {
  constInitializer,
  imported,
  matchesImport,
  propertyName,
} from "../syntax.ts";

const DECODERS = new Set([
  "decodeEffect",
  "decodeExit",
  "decodeOption",
  "decodePromise",
  "decodeResult",
  "decodeSync",
  "decodeUnknownEffect",
  "decodeUnknownExit",
  "decodeUnknownOption",
  "decodeUnknownPromise",
  "decodeUnknownResult",
  "decodeUnknownSync",
]);

const CONFIG_MODULE = /(?:^|[/#])config(?:\.[cm]?[jt]s)?$/u;

const optionsSchema: RuleOptionsSchema = [
  {
    type: "object",
    properties: { decodeFiles: { type: "array", items: { type: "string" } } },
    additionalProperties: false,
  },
];

const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({
        decodeFiles: Schema.optionalKey(Schema.Array(Schema.String)),
      })
    ),
  ]),
  { errors: "all" }
);

const checksDecoding = (filename: string, options: Readonly<Options>) => {
  const files = decodeOptions(options)[0]?.decodeFiles;

  return files === undefined || isAllowed(filename, files);
};

const decoderName = (source: SourceCode, callee: ESTree.Node) => {
  const ref = imported(source, callee);
  const name = ref?.names.at(-1) ?? "";

  return DECODERS.has(name) &&
    (matchesImport(ref, ["effect"], `Schema.${name}`) ||
      matchesImport(ref, ["effect/Schema"], name))
    ? name
    : undefined;
};

const collectsAllErrors = (
  source: SourceCode,
  node: ESTree.Node | undefined
): boolean => {
  const options =
    node?.type === "Identifier" ? constInitializer(source, node) : node;

  const object =
    options?.type === "TSAsExpression" ? options.expression : options;

  return (
    object?.type === "ObjectExpression" &&
    object.properties.some(
      (property) =>
        property.type === "Property" &&
        propertyName(property.key) === "errors" &&
        property.value.type === "Literal" &&
        property.value.value === "all"
    )
  );
};

const rootIdentifier = (node: ESTree.Node): ESTree.Node => {
  if (node.type === "CallExpression") {
    return rootIdentifier(node.callee);
  }

  return node.type === "MemberExpression" ? rootIdentifier(node.object) : node;
};

const isConfigExpression = (source: SourceCode, node: ESTree.Node) => {
  const root = rootIdentifier(node);

  if (root === node) {
    return false;
  }

  const ref = imported(source, root);

  return (
    matchesImport(ref, ["effect"], "Config") ||
    (ref?.from === "effect/Config" && ref.names.length === 0)
  );
};

const isFromConfigModule = (source: SourceCode, node: ESTree.Node) => {
  const ref = imported(source, node);

  return (
    ref !== undefined && ref.names.length === 1 && CONFIG_MODULE.test(ref.from)
  );
};

const isConfigValue = (source: SourceCode, node: ESTree.Node) => {
  if (node.type !== "Identifier") {
    return isConfigExpression(source, node);
  }

  const initializer = constInitializer(source, node);

  return (
    (initializer !== undefined && isConfigExpression(source, initializer)) ||
    isFromConfigModule(source, node)
  );
};

const yieldedConfig = (source: SourceCode, node: ESTree.Node | null) =>
  node?.type === "YieldExpression" &&
  node.delegate &&
  node.argument !== null &&
  isConfigValue(source, node.argument);

const readsConfig = (source: SourceCode, statement: ESTree.Node) => {
  if (statement.type === "ExpressionStatement") {
    return yieldedConfig(source, statement.expression);
  }

  return (
    statement.type === "VariableDeclaration" &&
    statement.declarations.length > 0 &&
    statement.declarations.every((declarator) =>
      yieldedConfig(source, declarator.init)
    )
  );
};

export const decodeAllErrors = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Require config and input decoding to report every error in one run: `{ errors: "all" }` on Schema decoders in the configured files, and one combined read instead of consecutive `yield*` Config reads.',
    },
    messages: {
      firstErrorOnly:
        'This Schema decoder stops at the first error. An operator who sets two wrong values must fix and run again once for each. Fix: pass `{ errors: "all" }` as the parse options, to the decoder or to the call it returns.',
      sequentialConfig:
        "This Effect reads Config values one `yield*` at a time, so it stops at the first wrong variable. An operator must fix and restart once for each. Fix: read them together with `readAll({ ... })` from `#shared/config.ts`, which reports every wrong variable in one run. `Config.all` also stops at the first error.",
    },
    schema: optionsSchema,
  },
  create(context) {
    const source = context.sourceCode;
    const decoding = checksDecoding(context.filename, context.options);

    const checkBody = (body: readonly ESTree.Node[]) => {
      let run = 0;

      for (const statement of body) {
        run = readsConfig(source, statement) ? run + 1 : 0;

        if (run === 2) {
          context.report({ messageId: "sequentialConfig", node: statement });
        }
      }
    };

    return {
      BlockStatement(node) {
        checkBody(node.body);
      },
      CallExpression(node) {
        if (!decoding || decoderName(source, node.callee) === undefined) {
          return;
        }

        const { parent } = node;

        const invocation =
          parent.type === "CallExpression" && parent.callee === node
            ? parent
            : undefined;

        if (
          !collectsAllErrors(source, node.arguments[1]) &&
          !collectsAllErrors(source, invocation?.arguments[1])
        ) {
          context.report({ messageId: "firstErrorOnly", node });
        }
      },
    };
  },
});
