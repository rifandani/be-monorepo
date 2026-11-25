import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import {
  constInitializer,
  imported,
  matchesImport,
  memberName,
} from "../syntax.ts";
import type { Reference } from "../syntax.ts";

const httpModules = ["effect/http", "effect/unstable/http"];

const namespaceModules = (namespace: string) =>
  httpModules.map((module) => `${module}/${namespace}`);

const requestMethods = new Set([
  "del",
  "execute",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
]);

const zodDecoders = new Set([
  "parse",
  "parseAsync",
  "safeParse",
  "safeParseAsync",
]);

const nonSchemaParsers = new Set(["Date", "JSON", "URL", "path"]);

const httpMember = (
  ref: Reference | undefined,
  namespaces: readonly string[],
  name: string
) =>
  namespaces.some(
    (namespace) =>
      matchesImport(ref, httpModules, `${namespace}.${name}`) ||
      matchesImport(ref, namespaceModules(namespace), name)
  );

const isSchemaDecoder = (ref: Reference | undefined) => {
  if (!ref) {
    return false;
  }

  const name =
    ref.from === "effect" && ref.names[0] === "Schema" && ref.names.length === 2
      ? ref.names[1]
      : ref.from === "effect/Schema" && ref.names.length === 1
        ? ref.names[0]
        : undefined;

  return name?.startsWith("decodeUnknown") ?? false;
};

const isDecoder = (source: SourceCode, callee: ESTree.Node) => {
  if (callee.type === "MemberExpression") {
    const name = memberName(callee);

    return (
      name !== undefined &&
      zodDecoders.has(name) &&
      !(
        callee.object.type === "Identifier" &&
        nonSchemaParsers.has(callee.object.name)
      )
    );
  }

  const decoder =
    callee.type === "Identifier"
      ? (constInitializer(source, callee) ?? callee)
      : callee;

  return (
    decoder.type === "CallExpression" &&
    isSchemaDecoder(imported(source, decoder.callee))
  );
};

const unwrapClient = (node: ESTree.Node): ESTree.Node => {
  if (node.type === "YieldExpression" && node.delegate && node.argument) {
    return unwrapClient(node.argument);
  }

  if (node.type === "TSAsExpression" || node.type === "TSNonNullExpression") {
    return unwrapClient(node.expression);
  }

  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    memberName(node.callee) === "pipe"
  ) {
    return unwrapClient(node.callee.object);
  }

  return node;
};

const isFunction = (node: ESTree.Node) =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

const requestScope = (node: ESTree.Node): ESTree.Node => {
  let scope: ESTree.Node = node;
  let current: ESTree.Node | null = node.parent;
  let inFunction = false;

  while (current && current.type !== "Program") {
    if (isFunction(current)) {
      scope = current;
      inFunction = true;
    } else if (!inFunction) {
      scope = current;
    }

    current = current.parent;
  }

  return scope;
};

const within = (outer: ESTree.Node, inner: ESTree.Node) =>
  inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];

interface PendingRequest {
  readonly node: ESTree.CallExpression;
  readonly scope: ESTree.Node;
}

export const validatedHttpResponse = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a status check and a schema decode for each outbound HTTP response body.",
    },
    messages: {
      unvalidatedJson:
        "This code reads an HTTP response body as JSON without a schema decode. A non-2xx body or a changed body shape then enters the domain as `unknown` or as a false type; a type argument is not validation. Fix: put the result directly into `Schema.decodeUnknown*(schema)` or `schema.parse` / `safeParse`, or pass the schema to ky as `.json(schema)`.",
      unvalidatedPipeline:
        "This `HttpClient` request has no status check or no schema decode. A non-2xx response or a changed body shape then enters the domain unchecked. Fix: add `HttpClientResponse.filterStatusOk` (or `HttpClient.filterStatusOk` on the client) and decode the body with `HttpClientResponse.schemaBodyJson(schema)`.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    const requests: PendingRequest[] = [];
    const statusChecks: ESTree.Node[] = [];
    const bodyDecodes: ESTree.Node[] = [];

    const isClient = (node: ESTree.Node) => {
      const init = constInitializer(source, node);

      return (
        init !== undefined &&
        httpMember(
          imported(source, unwrapClient(init)),
          ["HttpClient"],
          "HttpClient"
        )
      );
    };

    const recordProof = (node: ESTree.Node) => {
      const ref = imported(source, node);

      if (
        httpMember(ref, ["HttpClient", "HttpClientResponse"], "filterStatusOk")
      ) {
        statusChecks.push(node);
      }

      if (
        httpMember(
          ref,
          ["HttpClientResponse", "HttpIncomingMessage"],
          "schemaBodyJson"
        )
      ) {
        bodyDecodes.push(node);
      }
    };

    const checkJson = (node: ESTree.CallExpression) => {
      if (
        node.callee.type !== "MemberExpression" ||
        memberName(node.callee) !== "json" ||
        node.arguments.length > 0
      ) {
        return;
      }

      const awaited =
        node.parent.type === "AwaitExpression" ? node.parent : undefined;

      if (!awaited && !node.typeArguments) {
        return;
      }

      const value = awaited ?? node;
      const consumer = value.parent;

      if (
        consumer.type === "CallExpression" &&
        consumer.arguments[0] === value &&
        isDecoder(source, consumer.callee)
      ) {
        return;
      }

      context.report({ node, messageId: "unvalidatedJson" });
    };

    const checkRequest = (node: ESTree.CallExpression) => {
      const { callee } = node;
      const method =
        callee.type === "MemberExpression" ? memberName(callee) : undefined;

      if (
        callee.type !== "MemberExpression" ||
        method === undefined ||
        !requestMethods.has(method)
      ) {
        return;
      }

      if (
        httpMember(imported(source, callee), ["HttpClient"], method) ||
        isClient(callee.object)
      ) {
        requests.push({ node, scope: requestScope(node) });
      }
    };

    return {
      CallExpression(node) {
        checkJson(node);
        checkRequest(node);
      },
      MemberExpression(node) {
        if (
          node.parent.type !== "MemberExpression" ||
          node.parent.object !== node
        ) {
          recordProof(node);
        }
      },
      Identifier(node) {
        if (node.parent.type !== "MemberExpression") {
          recordProof(node);
        }
      },
      "Program:exit"() {
        for (const { node, scope } of requests) {
          const covered = (proofs: readonly ESTree.Node[]) =>
            proofs.some((proof) => within(scope, proof));

          if (!(covered(statusChecks) && covered(bodyDecodes))) {
            context.report({ node, messageId: "unvalidatedPipeline" });
          }
        }
      },
    };
  },
});
