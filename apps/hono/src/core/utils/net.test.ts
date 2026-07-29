import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  getClientIpAddress,
  getClientIpAddressFromContext,
  ipAddressHeaders,
} from "./net.js";

describe(getClientIpAddress, () => {
  it("returns null when no address header is present", () => {
    expect(getClientIpAddress(new Headers())).toBeNull();
  });

  it("prefers the cloudflare header above all others", () => {
    const headers = new Headers({
      [ipAddressHeaders.cfConnectingIp]: "1.1.1.1",
      [ipAddressHeaders.forwarded]: "for=5.5.5.5",
      [ipAddressHeaders.xClientIp]: "4.4.4.4",
      [ipAddressHeaders.xForwardedFor]: "2.2.2.2",
      [ipAddressHeaders.xRealIp]: "3.3.3.3",
    });

    expect(getClientIpAddress(headers)).toBe("1.1.1.1");
  });

  it("takes the first hop from x-forwarded-for and trims it", () => {
    const headers = new Headers({
      [ipAddressHeaders.xForwardedFor]: " 2.2.2.2 , 10.0.0.1, 10.0.0.2",
      [ipAddressHeaders.xRealIp]: "3.3.3.3",
    });

    expect(getClientIpAddress(headers)).toBe("2.2.2.2");
  });

  it("falls through to x-real-ip", () => {
    const headers = new Headers({
      [ipAddressHeaders.xClientIp]: "4.4.4.4",
      [ipAddressHeaders.xRealIp]: "3.3.3.3",
    });

    expect(getClientIpAddress(headers)).toBe("3.3.3.3");
  });

  it("falls through to x-client-ip", () => {
    const headers = new Headers({
      [ipAddressHeaders.forwarded]: "for=5.5.5.5",
      [ipAddressHeaders.xClientIp]: "4.4.4.4",
    });

    expect(getClientIpAddress(headers)).toBe("4.4.4.4");
  });

  it("parses the for= directive of an RFC 7239 Forwarded header", () => {
    const headers = new Headers({
      [ipAddressHeaders.forwarded]: "by=proxy;for=5.5.5.5;proto=https",
    });

    expect(getClientIpAddress(headers)).toBe("5.5.5.5");
  });

  it("returns null when Forwarded carries no for= directive", () => {
    const headers = new Headers({
      [ipAddressHeaders.forwarded]: "by=proxy;proto=https",
    });

    expect(getClientIpAddress(headers)).toBeNull();
  });
});

// The helper reads the address off the connection rather than the headers, so
// it needs a context carrying node's `incoming` binding. Driving it through a
// real Hono app is the only way to get a genuine Context here.
const requestWithSocket = async (socket: Record<string, unknown> | null) => {
  const app = new Hono();
  app.get("/", async (c) =>
    c.text((await getClientIpAddressFromContext(c)) ?? "null")
  );

  const res = await app.request("/", {}, { incoming: { socket } });
  return await res.text();
};

describe(getClientIpAddressFromContext, () => {
  it("reads the remote address off the node socket", async () => {
    await expect(
      requestWithSocket({
        remoteAddress: "9.9.9.9",
        remoteFamily: "IPv4",
        remotePort: 51_000,
      })
    ).resolves.toBe("9.9.9.9");
  });

  it("returns null when the socket has no remote address", async () => {
    await expect(
      requestWithSocket({
        remoteAddress: undefined,
        remoteFamily: "IPv6",
        remotePort: 51_000,
      })
    ).resolves.toBe("null");
  });
});
