// import type { HttpBindings } from '@hono/node-server';
import type { RequestIdVariables } from "hono/request-id";
import type { TimingVariables } from "hono/timing";

import type { auth } from "@/auth/utils/index.js";

interface AuthVariables {
  session: typeof auth.$Infer.Session.session | null;
  user: typeof auth.$Infer.Session.user | null;
}

export type Variables = RequestIdVariables & TimingVariables & AuthVariables;
// HttpBindings; // if we use node.js runtime, use this to access the Node.js APIs from `c.env.incoming` and `c.env.outgoing`
