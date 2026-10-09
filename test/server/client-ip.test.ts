import { describe, expect, it } from "vitest";

import { rateLimitKey } from "../../src/server/client-ip.js";

describe("rateLimitKey", () => {
  it("AC-002.8 keeps IPv4 addresses as they are", () => {
    expect(rateLimitKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("AC-002.8 counts an IPv4-mapped IPv6 address as its IPv4 address", () => {
    expect(rateLimitKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it.each([
    ["2001:db8:1:2::1", "2001:db8:1:2::/64"],
    ["2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["2001:DB8:1:2:0:0:0:9", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["2001:db8:1:2::203.0.113.7", "2001:db8:1:2::/64"],
  ])("AC-002.8 groups %s into its /64 (%s)", (ip, key) => {
    expect(rateLimitKey(ip)).toBe(key);
  });

  it("AC-002.8 keeps different /64 networks apart", () => {
    expect(rateLimitKey("2001:db8:1:2::1")).not.toBe(rateLimitKey("2001:db8:1:3::1"));
  });

  it("passes through values that are not IP addresses", () => {
    expect(rateLimitKey("unknown")).toBe("unknown");
  });
});
