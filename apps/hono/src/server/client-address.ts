import type { Context } from "hono";
import { getRuntimeKey } from "hono/adapter";
import type { ConnInfo } from "hono/conninfo";
import type { Env, Input } from "hono/types";

interface AddressHeader {
  readonly name: string;
  readonly read: (value: string) => string | null;
}

const plain = (name: string): AddressHeader => ({
  name,
  read: (value) => value,
});

const firstHop = (name: string): AddressHeader => ({
  name,
  read: (value) => value.replace(/,.*/su, "").trim(),
});

const FORWARDED: AddressHeader = {
  name: "forwarded",
  read: (value) => /for=(?<ip>[^;,\s]+)/u.exec(value)?.groups?.ip ?? null,
};

const ADDRESS_HEADERS: readonly AddressHeader[] = [
  plain("cf-connecting-ip"),
  firstHop("x-forwarded-for"),
  plain("x-real-ip"),
  plain("x-client-ip"),
  FORWARDED,
];

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
