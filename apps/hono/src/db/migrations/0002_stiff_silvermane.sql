--> Better Auth 1.7 keys an account by (issuer, accountId). The column is added
--> nullable, backfilled, and only then tightened, so the migration survives a
--> table that already holds rows.
--> https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account" SET "issuer" = 'local:credential' WHERE "provider_id" = 'credential';--> statement-breakpoint
UPDATE "account" SET "issuer" = 'local:oauth:' || "provider_id" WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_issuer_accountId_unique" UNIQUE("issuer","account_id");
