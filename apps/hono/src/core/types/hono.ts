// import type { HttpBindings } from '@hono/node-server';
import type { EvlogVariables } from "evlog/hono";
import type { RequestIdVariables } from "hono/request-id";
import type { TimingVariables } from "hono/timing";
import type { Simplify } from "type-fest";

import type { auth } from "@/auth/utils/index.js";

interface AuthVariables {
  session: typeof auth.$Infer.Session.session | null;
  user: typeof auth.$Infer.Session.user | null;
}

/**
 * `Simplify` collapses the intersection into one object type, so hovers and
 * type errors name the actual keys instead of `A & B & C & D`.
 */
export type Variables = Simplify<
  RequestIdVariables &
    TimingVariables &
    AuthVariables &
    EvlogVariables["Variables"]
>;
// HttpBindings; // if we use node.js runtime, use this to access the Node.js APIs from `c.env.incoming` and `c.env.outgoing`
