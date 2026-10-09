import { isIPv6 } from "node:net";

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Client IP for rate limits (design § Security). With `trustProxy` (TRUST_PROXY=true, only
 * behind Caddy with the API port unpublished) it is the last X-Forwarded-For entry: the
 * address Caddy saw, since Caddy ignores a client-sent value unless the sender is a trusted
 * proxy. Otherwise the header is ignored, so a directly reachable API cannot be fooled by a
 * forged one, and the socket address is used.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const last = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (last !== undefined && last !== "") {
      return last;
    }
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No socket, e.g. app.request() in tests.
    return "unknown";
  }
}

/** The 8 hextets of an IPv6 address, expanding `::` and a trailing dotted IPv4 part. */
function ipv6Hextets(address: string): string[] {
  let text = address.split("%")[0] ?? address; // drop a zone id such as %eth0
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted !== null) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeros = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map((hextet) =>
    hextet.toLowerCase().replace(/^0+(?=.)/, ""),
  );
}

/**
 * Key for per-client limits. One IPv6 client typically controls a whole /64, so IPv6
 * addresses are grouped by /64; IPv4-mapped IPv6 (`::ffff:1.2.3.4`) counts as the IPv4
 * address (AC-002.8).
 */
export function rateLimitKey(ip: string): string {
  if (!isIPv6(ip)) {
    return ip;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1] !== undefined) {
    return mapped[1];
  }
  return `${ipv6Hextets(ip).slice(0, 4).join(":")}::/64`;
}
