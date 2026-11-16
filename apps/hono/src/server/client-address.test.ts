import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  clientAddressHeaders,
  resolveClientAddress,
} from "./client-address.ts";

const DEFAULT_SOCKET = {
  remoteAddress: "9.9.9.9",
  remoteFamily: "IPv4",
  remotePort: 51_000,
};

// The resolver reads the connection off node's `incoming` binding, so it needs
// a genuine Context. Driving it through a real Hono app is the only way to get
// one.
const resolve = async (
  headers: Record<string, string> = {},
  socket: Record<string, unknown> | null = DEFAULT_SOCKET
) => {
  const app = new Hono();
  app.get("/", async (c) => c.text(await resolveClientAddress(c)));

  const res = await app.request("/", { headers }, { incoming: { socket } });

  return res.text();
};

describe(resolveClientAddress, () => {
  describe("from headers", () => {
    it("prefers the cloudflare header above all others", async () => {
      await expect(
        resolve({
          "cf-connecting-ip": "1.1.1.1",
          forwarded: "for=5.5.5.5",
          "x-client-ip": "4.4.4.4",
          "x-forwarded-for": "2.2.2.2",
          "x-real-ip": "3.3.3.3",
        })
      ).resolves.toBe("1.1.1.1");
    });

    it("takes the first hop from x-forwarded-for and trims it", async () => {
      await expect(
        resolve({
          "x-forwarded-for": " 2.2.2.2 , 10.0.0.1, 10.0.0.2",
          "x-real-ip": "3.3.3.3",
        })
      ).resolves.toBe("2.2.2.2");
    });

    it("falls through to x-real-ip", async () => {
      await expect(
        resolve({ "x-client-ip": "4.4.4.4", "x-real-ip": "3.3.3.3" })
      ).resolves.toBe("3.3.3.3");
    });

    it("falls through to x-client-ip", async () => {
      await expect(
        resolve({ forwarded: "for=5.5.5.5", "x-client-ip": "4.4.4.4" })
      ).resolves.toBe("4.4.4.4");
    });

    it("parses the for= directive of an RFC 7239 Forwarded header", async () => {
      await expect(
        resolve({ forwarded: "by=proxy;for=5.5.5.5;proto=https" })
      ).resolves.toBe("5.5.5.5");
    });

    it("skips a header whose value holds no address", async () => {
      await expect(
        resolve({ "x-forwarded-for": " , 2.2.2.2", "x-real-ip": "3.3.3.3" })
      ).resolves.toBe("3.3.3.3");
    });
  });

  describe("from the connection", () => {
    it("reads the remote address off the node socket when no header gives one", async () => {
      await expect(resolve()).resolves.toBe("9.9.9.9");
    });

    it("ignores a Forwarded header that has no for= directive", async () => {
      await expect(
        resolve({ forwarded: "by=proxy;proto=https" })
      ).resolves.toBe("9.9.9.9");
    });

    it("prefers a header over the connection", async () => {
      await expect(resolve({ "x-real-ip": "3.3.3.3" })).resolves.toBe(
        "3.3.3.3"
      );
    });
  });

  describe("anonymous", () => {
    it("is used when the socket has no remote address", async () => {
      await expect(
        resolve(
          {},
          { remoteAddress: undefined, remoteFamily: "IPv6", remotePort: 51_000 }
        )
      ).resolves.toBe("anonymous");
    });

    it("is used when the socket address is empty", async () => {
      await expect(
        resolve({}, { ...DEFAULT_SOCKET, remoteAddress: "" })
      ).resolves.toBe("anonymous");
    });
  });
});

describe("the header list for Better Auth", () => {
  it("holds the exact headers Better Auth receives, in resolution order", () => {
    expect(clientAddressHeaders).toStrictEqual([
      "cf-connecting-ip",
      "x-forwarded-for",
      "x-real-ip",
      "x-client-ip",
    ]);
  });

  it("matches the order in which the resolver reads headers", async () => {
    // Step i sends only the headers from position i onward, each with its own
    // address. The resolver must pick the header at position i every time.
    const winners = await Promise.all(
      clientAddressHeaders.map(async (_, index) => {
        const sent = clientAddressHeaders.slice(index);

        const address = await resolve(
          Object.fromEntries(
            sent.map((name) => [
              name,
              `10.0.0.${clientAddressHeaders.indexOf(name) + 1}`,
            ])
          )
        );

        return clientAddressHeaders[Number(address.split(".")[3]) - 1];
      })
    );

    expect(winners).toStrictEqual([...clientAddressHeaders]);
  });

  it("leaves out forwarded, which Better Auth cannot parse", () => {
    expect(clientAddressHeaders).not.toContain("forwarded");
  });
});
