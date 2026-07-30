import type { Context } from "hono";
import { getRuntimeKey } from "hono/adapter";
import type { ConnInfo } from "hono/conninfo";
import type { Env, Input } from "hono/types";

export const ipAddressHeaders = {
  cfConnectingIp: "cf-connecting-ip",
  forwarded: "forwarded",
  xClientIp: "x-client-ip",
  xForwardedFor: "x-forwarded-for",
  xRealIp: "x-real-ip",
} as const;

/**
 * Get the client IP address from the request headers.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Forwarded
 *
 * @param headers - The headers object.
 * @returns The client IP address or `null` if not found.
 */
export const getClientIpAddress = (headers: Headers): string | null => {
  // 1. Cloudflare
  const cfConnectingIp = headers.get(ipAddressHeaders.cfConnectingIp);
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // 2. X-Forwarded-For (most common)
  const xForwardedFor = headers.get(ipAddressHeaders.xForwardedFor);
  if (xForwardedFor) {
    // Dropping everything after the first comma rather than `split(",")[0]`,
    // whose index access is optional under `noUncheckedIndexedAccess` and so
    // adds a `?? null` branch that no input can reach.
    return xForwardedFor.replace(/,.*/su, "").trim();
  }

  // 3. X-Real-IP (Nginx)
  const xRealIp = headers.get(ipAddressHeaders.xRealIp);
  if (xRealIp) {
    return xRealIp;
  }

  // 4. X-Client-IP (used by some load balancers and proxies)
  const xClientIp = headers.get(ipAddressHeaders.xClientIp);
  if (xClientIp) {
    return xClientIp;
  }

  // 5. Forwarded (RFC 7239 standard)
  const forwarded = headers.get(ipAddressHeaders.forwarded);
  if (forwarded) {
    const match = forwarded.match(/for=(?<ip>[^;,\s]+)/u);
    if (match?.groups?.ip) {
      return match.groups.ip;
    }
  }

  // 6. Fallback to null
  return null;
};

/**
 * Load the current runtime's `getConnInfo` implementation.
 *
 * Kept in its own function deliberately: a ternary between two `await import()`
 * expressions makes v8 lose coverage for every statement that follows it in the
 * same function, so the conditional import lives here and the caller awaits a
 * plain call.
 */
const importGetConnInfo = () =>
  getRuntimeKey() === "node"
    ? import("@hono/node-server/conninfo")
    : import("hono/bun");

/**
 * Get the client IP address from hono context.
 *
 * @param c - The context object.
 * @returns The client IP address or `null` if not found.
 */
export const getClientIpAddressFromContext = async <
  E extends Env,
  P extends string,
  I extends Input,
>(
  c: Context<E, P, I>
): Promise<string | null> => {
  const { getConnInfo } = await importGetConnInfo();
  const connInfo: ConnInfo = getConnInfo(c);

  return connInfo.remote.address || null;
};
