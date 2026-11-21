import type { EvlogVariables } from "evlog/hono";
import type { RequestIdVariables } from "hono/request-id";
import type { TimingVariables } from "hono/timing";
import type { Simplify } from "type-fest";

import type { auth } from "#server/auth.ts";

interface AuthVariables {
  session: typeof auth.$Infer.Session.session | null;
  user: typeof auth.$Infer.Session.user | null;
}

export type Variables = Simplify<
  RequestIdVariables &
    TimingVariables &
    AuthVariables &
    EvlogVariables["Variables"]
>;
