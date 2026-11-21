import path from "node:path";

import { BASELINE } from "./no-comments-baseline.ts";

interface Position {
  readonly column: number;
  readonly line: number;
}

interface Location {
  readonly end: Position;
  readonly start: Position;
}

interface Comment {
  readonly loc: Location;
  readonly type: string;
}

interface Report {
  readonly data: Readonly<Record<"actual" | "allowed", string>>;
  readonly loc: Location;
  readonly messageId: "banned" | "overBaseline" | "staleBaseline";
}

interface Context {
  readonly filename: string;
  readonly sourceCode: { readonly getAllComments: () => readonly Comment[] };
  readonly report: (report: Report) => void;
}

const ROOT = path.dirname(import.meta.dirname);
const ADR = "docs/adr/0006-code-has-no-comments.md";

const FIRST_LINE: Location = {
  end: { column: 0, line: 1 },
  start: { column: 0, line: 1 },
};

const relativePath = (filename: string): string =>
  path.relative(ROOT, filename).split(path.sep).join("/");

const create = (context: Context) => ({
  Program: () => {
    const comments = context.sourceCode
      .getAllComments()
      .filter((comment) => comment.type !== "Shebang");

    const allowed = BASELINE.get(relativePath(context.filename)) ?? 0;
    const actual = comments.length;
    const data = { actual: String(actual), allowed: String(allowed) };

    if (actual < allowed) {
      context.report({ data, loc: FIRST_LINE, messageId: "staleBaseline" });

      return;
    }

    if (actual === allowed) {
      return;
    }

    const messageId = allowed === 0 ? "banned" : "overBaseline";

    for (const comment of comments) {
      context.report({ data, loc: comment.loc, messageId });
    }
  },
});

export default {
  meta: { name: "local" },
  rules: {
    "no-comments": {
      create,
      meta: {
        docs: {
          description:
            "Ban code comments. A file in the baseline keeps at most its count, and the count only goes down.",
        },
        messages: {
          banned: `Do not write comments. Put a decision in an ADR, and file an issue for a workaround. See ${ADR}.`,
          overBaseline: `This file has {{actual}} comments, and the baseline allows {{allowed}}. Remove comments, do not add them. See ${ADR}.`,
          staleBaseline:
            "This file has {{actual}} comments, and the baseline allows {{allowed}}. Run `bun run lint:comments` to lower the baseline.",
        },
        schema: [],
        type: "suggestion",
      },
    },
  },
};
