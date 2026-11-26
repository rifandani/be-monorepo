import type { ESTree, Scope, SourceCode } from "@oxlint/plugins";

export interface Reference {
  readonly from: string;
  readonly names: readonly string[];
}

export const propertyName = (key: ESTree.Node) => {
  if (key.type === "Identifier") {
    return key.name;
  }

  return key.type === "Literal" && typeof key.value === "string"
    ? key.value
    : undefined;
};

export const memberName = (node: ESTree.MemberExpression) =>
  node.computed && node.property.type !== "Literal"
    ? undefined
    : propertyName(node.property);

export const definition = (
  source: SourceCode,
  identifier: ESTree.Node & { readonly name: string }
) => {
  let scope: Scope | null = source.getScope(identifier);

  while (scope) {
    const variable = scope.set.get(identifier.name);

    if (variable) {
      return variable.defs[0];
    }

    scope = scope.upper;
  }

  return;
};

export function constInitializer(
  source: SourceCode,
  identifier: ESTree.Node
): ESTree.Expression | undefined {
  if (identifier.type !== "Identifier") {
    return undefined;
  }

  const declarator = definition(source, identifier)?.node;

  return declarator?.type === "VariableDeclarator" &&
    declarator.id.type === "Identifier" &&
    declarator.parent.type === "VariableDeclaration" &&
    declarator.parent.kind === "const"
    ? (declarator.init ?? undefined)
    : undefined;
}

export function imported(
  source: SourceCode,
  node: ESTree.Node
): Reference | undefined {
  if (node.type === "MemberExpression") {
    const name = memberName(node);
    const ref = name === undefined ? undefined : imported(source, node.object);

    return ref && name !== undefined
      ? { from: ref.from, names: [...ref.names, name] }
      : undefined;
  }

  if (node.type !== "Identifier") {
    return undefined;
  }

  const binding = definition(source, node);
  const declaration = binding?.parent;

  if (
    binding?.type !== "ImportBinding" ||
    declaration?.type !== "ImportDeclaration" ||
    declaration.importKind === "type"
  ) {
    return undefined;
  }

  const specifier = binding.node;

  if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
    const name = propertyName(specifier.imported);

    return name === undefined
      ? undefined
      : { from: declaration.source.value, names: [name] };
  }

  return specifier.type === "ImportNamespaceSpecifier"
    ? { from: declaration.source.value, names: [] }
    : undefined;
}

export const matchesImport = (
  ref: Reference | undefined,
  from: readonly string[],
  name: string
) =>
  ref !== undefined && from.includes(ref.from) && ref.names.join(".") === name;
