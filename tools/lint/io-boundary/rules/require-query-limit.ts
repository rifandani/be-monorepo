import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { constInitializer, memberName, propertyName } from "../syntax.ts";

const selectMethods = new Set(["select", "selectDistinct", "selectDistinctOn"]);

const subqueryOperators = new Set([
  "exists",
  "inArray",
  "notExists",
  "notInArray",
]);

const calledMember = (node: ESTree.Node) =>
  node.type === "CallExpression" && node.callee.type === "MemberExpression"
    ? memberName(node.callee)
    : undefined;

const isSelectFrom = (node: ESTree.CallExpression) => {
  if (
    calledMember(node) !== "from" ||
    node.callee.type !== "MemberExpression"
  ) {
    return false;
  }

  const select = calledMember(node.callee.object);

  return select !== undefined && selectMethods.has(select);
};

const chainEnd = (node: ESTree.CallExpression) => {
  const methods: string[] = [];
  let current: ESTree.Node = node;

  while (
    current.parent.type === "MemberExpression" &&
    current.parent.object === current &&
    current.parent.parent.type === "CallExpression" &&
    current.parent.parent.callee === current.parent
  ) {
    const method = memberName(current.parent);

    if (method !== undefined) {
      methods.push(method);
    }

    current = current.parent.parent;
  }

  return { methods, outermost: current };
};

const isSubqueryOperand = (node: ESTree.Node) => {
  const call = node.parent;

  return (
    call?.type === "CallExpression" &&
    call.arguments.some((argument) => argument === node) &&
    call.callee.type === "Identifier" &&
    subqueryOperators.has(call.callee.name)
  );
};

const isBoundedSelect = (node: ESTree.CallExpression) => {
  const { methods, outermost } = chainEnd(node);

  return (
    methods.includes("limit") ||
    methods.includes("as") ||
    isSubqueryOperand(outermost)
  );
};

const isFindMany = (node: ESTree.CallExpression) => {
  if (
    calledMember(node) !== "findMany" ||
    node.callee.type !== "MemberExpression"
  ) {
    return false;
  }

  const table = node.callee.object;

  return (
    table.type === "MemberExpression" &&
    table.object.type === "MemberExpression" &&
    memberName(table.object) === "query"
  );
};

const hasLimitKey = (node: ESTree.Node | undefined) =>
  node?.type === "ObjectExpression" &&
  node.properties.some(
    (property) =>
      property.type === "Property" &&
      !property.computed &&
      propertyName(property.key) === "limit"
  );

export const requireQueryLimit = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a result bound (`.limit()` or a `limit` option) on each Drizzle list query.",
    },
    messages: {
      unboundedSelect:
        "This `select(...).from(...)` query has no `.limit()`. When the table grows, the query returns all rows and can use all the memory of the process. Fix: add `.limit(n)` to the chain. If the query selects by a unique key, keep it and add `// oxlint-disable-next-line io-boundary/require-query-limit -- <reason>`.",
      unboundedFindMany:
        "This `findMany` call has no `limit` option. When the table grows, the query returns all rows and can use all the memory of the process. Fix: add `limit: n` to the options object, or use `findFirst` for one row. If the query selects by a unique key, keep it and add `// oxlint-disable-next-line io-boundary/require-query-limit -- <reason>`.",
    },
  },
  create(context) {
    const source = context.sourceCode;

    const findManyOptions = (node: ESTree.CallExpression) => {
      const [argument] = node.arguments;

      return argument?.type === "Identifier"
        ? constInitializer(source, argument)
        : argument;
    };

    return {
      CallExpression(node) {
        if (isSelectFrom(node) && !isBoundedSelect(node)) {
          context.report({ node, messageId: "unboundedSelect" });
        }

        if (isFindMany(node) && !hasLimitKey(findManyOptions(node))) {
          context.report({ node, messageId: "unboundedFindMany" });
        }
      },
    };
  },
});
