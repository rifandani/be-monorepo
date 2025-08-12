import type { Context } from 'hono';
import { getRuntimeKey } from 'hono/adapter';
import type { ConnInfo } from 'hono/conninfo';
import type { Env, Input } from 'hono/types';

export const ipAddressHeaders = {
  cfConnectingIp: 'cf-connecting-ip',
  xForwardedFor: 'x-forwarded-for',
  xRealIp: 'x-real-ip',
  xClientIp: 'x-client-ip',
  forwarded: 'forwarded',
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
export function getClientIpAddress(headers: Headers): string | null {
  // 1. Cloudflare
  const cfConnectingIp = headers.get(ipAddressHeaders.cfConnectingIp);
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // 2. X-Forwarded-For (most common)
  const xForwardedFor = headers.get(ipAddressHeaders.xForwardedFor);
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0]!.trim();
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
    const match = forwarded.match(/for=([^;,\s]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }

  // 6. Fallback to null
  return null;
}

/**
 * Get the client IP address from hono context.
 *
 * @param c - The context object.
 * @returns The client IP address or `null` if not found.
 */
export async function getClientIpAddressFromContext<
  E extends Env,
  P extends string,
  I extends Input,
>(c: Context<E, P, I>): Promise<string | null> {
  // get current runtime
  const runtime = getRuntimeKey();
  let connInfo: ConnInfo | null = null;

  if (runtime === 'node') {
    const { getConnInfo } = await import('@hono/node-server/conninfo');
    connInfo = getConnInfo(c);
  } else {
    const { getConnInfo } = await import('hono/bun');
    connInfo = getConnInfo(c);
  }

  return connInfo?.remote.address || null;
}
