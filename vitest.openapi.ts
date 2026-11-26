export interface OpenApiResponseLike {
  readonly $ref?: string | undefined;
  readonly description?: string | undefined;
}

export interface OpenApiOperationLike {
  readonly parameters?: readonly unknown[] | undefined;
  readonly requestBody?: unknown;
  readonly responses?:
    | Readonly<Record<string, OpenApiResponseLike>>
    | undefined;
}

export interface OpenApiPathItemLike {
  readonly delete?: OpenApiOperationLike | undefined;
  readonly get?: OpenApiOperationLike | undefined;
  readonly head?: OpenApiOperationLike | undefined;
  readonly options?: OpenApiOperationLike | undefined;
  readonly parameters?: readonly unknown[] | undefined;
  readonly patch?: OpenApiOperationLike | undefined;
  readonly post?: OpenApiOperationLike | undefined;
  readonly put?: OpenApiOperationLike | undefined;
  readonly trace?: OpenApiOperationLike | undefined;
  readonly "x-oai-additionalOperations"?:
    | Readonly<Record<string, OpenApiOperationLike | undefined>>
    | undefined;
}

export interface OpenApiDocumentLike {
  readonly paths?:
    | Readonly<Record<string, OpenApiPathItemLike | undefined>>
    | undefined;
}

const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

const hasItems = (list: readonly unknown[] | undefined) =>
  list !== undefined && list.length > 0;

const acceptsInput = (
  pathItem: OpenApiPathItemLike,
  operation: OpenApiOperationLike
) =>
  operation.requestBody !== undefined ||
  hasItems(operation.parameters) ||
  hasItems(pathItem.parameters);

const declares400 = (operation: OpenApiOperationLike) =>
  operation.responses !== undefined &&
  Object.hasOwn(operation.responses, "400");

const operationsOf = (pathItem: OpenApiPathItemLike) => [
  ...METHODS.map((method) => [method, pathItem[method]] as const),
  ...Object.entries(pathItem["x-oai-additionalOperations"] ?? {}),
];

export const findInputOperationsWithout400 = (
  document: OpenApiDocumentLike
): readonly string[] =>
  Object.entries(document.paths ?? {}).flatMap(([path, pathItem]) =>
    pathItem === undefined
      ? []
      : operationsOf(pathItem).flatMap(([method, operation]) =>
          operation !== undefined &&
          acceptsInput(pathItem, operation) &&
          !declares400(operation)
            ? [`${method.toUpperCase()} ${path}`]
            : []
        )
  );
