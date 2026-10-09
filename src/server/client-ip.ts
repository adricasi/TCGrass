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
