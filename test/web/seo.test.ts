import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_PUBLIC_URL, withPublicUrl } from "../../web/public-url.js";
import { repoPath } from "../server/helpers.js";

const indexHtml = readFileSync(repoPath("web/index.html"), "utf8");

function meta(attribute: "name" | "property", key: string): string | undefined {
  return new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="([^"]*)"`).exec(indexHtml)?.[1];
}

describe("search and share metadata (T-015)", () => {
  it("T-015 describes the game for search results", () => {
    const description = meta("name", "description") ?? "";
    expect(description.length).toBeGreaterThan(50);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(indexHtml).toMatch(/<title>TCGrass[^<]+<\/title>/);
    expect(indexHtml).toContain('<link rel="canonical" href="%PUBLIC_URL%/" />');
  });

  it("T-015 gives link previews a title, description and absolute 1200x630 image", () => {
    expect(meta("property", "og:type")).toBe("website");
    expect(meta("property", "og:title")).toMatch(/TCGrass/);
    expect(meta("property", "og:description")).toBeTruthy();
    expect(meta("property", "og:url")).toBe("%PUBLIC_URL%/");
    expect(meta("property", "og:image")).toBe("%PUBLIC_URL%/og-image.jpg");
    expect(meta("property", "og:image:alt")).toBeTruthy();
    expect(meta("name", "twitter:card")).toBe("summary_large_image");

    // Small enough for every link-preview fetcher (some drop images over ~300 KB).
    const image = readFileSync(repoPath("web/public/og-image.jpg"));
    expect(image.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(image.length).toBeLessThan(300 * 1024);
  });

  it("T-015 fills in the public URL at build time, without a trailing slash", () => {
    expect(withPublicUrl(indexHtml, "https://cards.example.org/")).toContain(
      '<meta property="og:image" content="https://cards.example.org/og-image.jpg" />',
    );
    expect(withPublicUrl("%PUBLIC_URL%/", undefined)).toBe(`${DEFAULT_PUBLIC_URL}/`);
    expect(withPublicUrl("%PUBLIC_URL%/", "  ")).toBe(`${DEFAULT_PUBLIC_URL}/`);
    expect(() => withPublicUrl("%PUBLIC_URL%", "not a url")).toThrow();
  });

  it("T-015 lets crawlers index the game but not the API", () => {
    const robots = readFileSync(repoPath("web/public/robots.txt"), "utf8");
    expect(robots).toMatch(/User-agent: \*/);
    expect(robots).toMatch(/Disallow: \/api\//);
  });
});
