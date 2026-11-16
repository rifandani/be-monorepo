import type { Context } from "hono";
import { getRuntimeKey } from "hono/adapter";
import type { ConnInfo } from "hono/conninfo";
import type { Env, Input } from "hono/types";

/**
 * Client address resolution. This module owns three things:
 * the ordered list of headers that can carry the address, how each header
 * value is read, and the fallback rule when no header gives an address.
 */

interface AddressHeader {
  readonly name: string;
  /** Read one raw header value. Return `null` if it holds no address. */
  readonly read: (value: string) => string | null;
}

/**
 * A header that holds one plain address. Better Auth can read it too.
 */
const plain = (name: string): AddressHeader => ({
  name,
  read: (value) => value,
});

/**
 * A comma-separated list of hops. The first hop is the client.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
 */
const firstHop = (name: string): AddressHeader => ({
  name,
  // Dropping everything after the first comma rather than `split(",")[0]`,
  // whose index access is optional under `noUncheckedIndexedAccess` and so
  // adds a `?? null` branch that no input can reach.
  read: (value) => value.replace(/,.*/su, "").trim(),
});

/**
 * RFC 7239 `Forwarded` header. The address is in the `for=` directive.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Forwarded
 */
const FORWARDED: AddressHeader = {
  name: "forwarded",
  read: (value) => /for=(?<ip>[^;,\s]+)/u.exec(value)?.groups?.ip ?? null,
};

/**
 * The one order for all callers. The first header that gives an address wins.
 * The order is data: it is an array, not the key order of an object.
 *
 * `cf-connecting-ip` is first because Cloudflare sets it to one address and
 * replaces any value from the client. `x-forwarded-for` is next because it is
 * the most common header. `forwarded` is last because it is rare.
 */
const ADDRESS_HEADERS: readonly AddressHeader[] = [
  plain("cf-connecting-ip"),
  firstHop("x-forwarded-for"),
  plain("x-real-ip"),
  plain("x-client-ip"),
  FORWARDED,
];

/**
 * The header names for Better Auth `advanced.ipAddress.ipAddressHeaders`, in
 * the order of `ADDRESS_HEADERS`.
 *
 * `forwarded` is not in this list. Better Auth reads the raw header value as
 * an address, and `for=...;proto=https` is not a valid address. It would skip
 * that header every time. Only this module can read it.
 */
export const clientAddressHeaders: readonly string[] = ADDRESS_HEADERS.flatMap(
  (header) => (header === FORWARDED ? [] : [header.name])
);

const readFromHeaders = (headers: Headers): string | null => {
  for (const header of ADDRESS_HEADERS) {
    const value = headers.get(header.name);
    const address = value === null ? null : header.read(value);

    if (address !== null && address.length > 0) {
      return address;
    }
  }

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
const importGetConnInfo = async () =>
  getRuntimeKey() === "node"
    ? import("@hono/node-server/conninfo")
    : import("hono/bun");

const readFromConnection = async <
  E extends Env,
  P extends string,
  I extends Input,
>(
  c: Context<E, P, I>
): Promise<string | null> => {
  const { getConnInfo } = await importGetConnInfo();
  const connInfo: ConnInfo = getConnInfo(c);

  return connInfo.remote.address ?? null;
};

/**
 * Get the client address of a request. The first non-empty answer wins:
 * the request headers, then the connection, then `anonymous`.
 */
export const resolveClientAddress = async <
  E extends Env,
  P extends string,
  I extends Input,
>(
  c: Context<E, P, I>
): Promise<string> => {
  const fromHeaders = readFromHeaders(c.req.raw.headers);

  if (fromHeaders !== null) {
    return fromHeaders;
  }

  const fromConnection = await readFromConnection(c);

  return fromConnection !== null && fromConnection.length > 0
    ? fromConnection
    : "anonymous";
};
