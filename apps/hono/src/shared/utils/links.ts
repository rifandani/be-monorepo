const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

interface ContractOperation {
  readonly description?: string;
  readonly operationId?: string;
  readonly summary?: string;
}

type ContractPathItem = Readonly<
  Partial<Record<HttpMethod, ContractOperation>>
>;

export interface Contract {
  readonly paths?: Readonly<Record<string, ContractPathItem>>;
  readonly servers?: readonly { readonly url: string }[];
}

export interface NextAction {
  readonly href: string;
  readonly method: string;
  readonly title: string;
}

export const absoluteUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.length === 0 ? undefined : value;

const operationTitle = (
  operation: ContractOperation,
  method: string,
  path: string
): string =>
  nonEmpty(operation.summary) ??
  nonEmpty(operation.description) ??
  nonEmpty(operation.operationId) ??
  `${method} ${path}`;

export const nextActions = (
  contract: Contract,
  fallbackBaseUrl: string
): NextAction[] => {
  const serverUrl = contract.servers?.[0]?.url ?? "";

  const baseUrl = URL.canParse(serverUrl)
    ? serverUrl
    : absoluteUrl(fallbackBaseUrl, serverUrl);

  return Object.entries(contract.paths ?? {}).flatMap(([path, pathItem]) =>
    HTTP_METHODS.flatMap((key) => {
      const operation = pathItem[key];

      if (operation === undefined) {
        return [];
      }

      const method = key.toUpperCase();

      return [
        {
          href: absoluteUrl(baseUrl, path),
          method,
          title: operationTitle(operation, method, path),
        },
      ];
    })
  );
};

const escapeLinkText = (text: string): string =>
  text.replaceAll(/[[\]]/gu, String.raw`\$&`);

export const nextActionsMarkdown = (actions: readonly NextAction[]): string => {
  if (actions.length === 0) {
    return "";
  }

  const items = actions.map(
    ({ href, method, title }) =>
      `- ${method} [${escapeLinkText(title)}](${href})`
  );

  return `${["## Next actions", "", ...items].join("\n")}\n`;
};
