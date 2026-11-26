import { RuleTester } from "oxlint/plugins-dev";

import { requireQueryLimit } from "./require-query-limit.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const reported = (code: string, messageId: string) => ({
  code,
  errors: [{ messageId }],
});

tester.run("io-boundary/require-query-limit", requireQueryLimit, {
  valid: [
    "const users = await db.select().from(userTable).limit(50);",
    "const users = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.active, true)).orderBy(userTable.id).limit(50).offset(100);",
    "const users = await tx.selectDistinct().from(userTable).limit(10);",
    "const users = await db.selectDistinctOn([userTable.email]).from(userTable).limit(10);",
    "const users = await db.query.userTable.findMany({ limit: 50 });",
    "const users = await db.query.userTable.findMany({ where: eq(userTable.active, true), limit: 50 });",
    'const users = await db.query.userTable.findMany({ "limit": 50 });',
    "const page = { limit: 50 }; const users = await db.query.userTable.findMany(page);",
    "const user = await db.query.userTable.findFirst();",
    "const user = await db.query.userTable.findFirst({ where: eq(userTable.id, id) });",
    "const rows = Array.from(items);",
    "const picked = list.select().map((item) => item.id);",
    "const users = repository.findMany();",
    "await db.insert(userTable).values({ id });",
    "const active = db.select({ id: userTable.id }).from(userTable).where(eq(userTable.active, true)).as('active'); const users = await db.select().from(active).limit(10);",
    "const users = await db.select().from(postTable).where(inArray(postTable.authorId, db.select({ id: userTable.id }).from(userTable))).limit(10);",
    "const users = await db.select().from(postTable).where(notInArray(postTable.authorId, db.select({ id: userTable.id }).from(userTable))).limit(10);",
    "const users = await db.select().from(userTable).where(exists(db.select().from(postTable).where(eq(postTable.authorId, userTable.id)))).limit(10);",
    "const users = await db.select().from(userTable).where(notExists(db.select().from(postTable).where(eq(postTable.authorId, userTable.id)))).limit(10);",
  ],
  invalid: [
    ...[
      "const users = await db.select().from(userTable);",
      "const users = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.active, true)).orderBy(userTable.id);",
      "const users = await db.select().from(userTable).offset(100);",
      "const users = await tx.selectDistinct().from(userTable);",
      "const users = await db.selectDistinctOn([userTable.email]).from(userTable);",
      "const [users, hash] = await Promise.all([db.select({ id: userTable.id }).from(userTable), hashPassword(value)]);",
      "const users = await db.select().from(userTable).where(eq(userTable.limit, 1));",
      "const users = await wrap(db.select().from(userTable));",
      "const users = await db.select().from(userTable).where(eq(userTable.alias, 'as'));",
    ].map((code) => reported(code, "unboundedSelect")),
    ...[
      "const users = await db.query.userTable.findMany();",
      "const users = await db.query.userTable.findMany({ where: eq(userTable.active, true) });",
      "const users = await db.query.userTable.findMany({ with: { posts: { limit: 5 } } });",
      "const users = await db.query.userTable.findMany({ ...options });",
      "const users = await db.query.userTable.findMany(options);",
      "let page = { limit: 50 }; const users = await db.query.userTable.findMany(page);",
      "const users = await db.query['userTable'].findMany({ orderBy: userTable.id });",
    ].map((code) => reported(code, "unboundedFindMany")),
  ],
});
