import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../server/helpers.js";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const manifest = JSON.parse(readFileSync(repoPath("web/public/manifest.webmanifest"), "utf8")) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
};
const indexHtml = readFileSync(repoPath("web/index.html"), "utf8");

/** Width and height from a PNG's IHDR chunk; throws if the file is not a PNG. */
function pngSize(publicPath: string): { width: number; height: number } {
  const bytes = readFileSync(repoPath(`web/public${publicPath}`));
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("installable PWA", () => {
  it("AC-013.1 manifest names the app and opens it full-screen from /", () => {
    // A fixed id keeps installs the same app even if start_url changes later.
    expect(manifest.id).toBe("/");
    expect(manifest.name).toBe("TCGrass");
    expect(manifest.short_name).toBe("TCGrass");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("AC-013.1 manifest lists 192 and 512 px PNG icons, plus a maskable one, that exist", () => {
    for (const size of ["192x192", "512x512"]) {
      const icon = manifest.icons.find(
        (entry) => entry.sizes === size && entry.purpose !== "maskable",
      );
      expect(icon?.type).toBe("image/png");
    }
    expect(manifest.icons.some((entry) => entry.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(icon.src)).toEqual({ width, height });
    }
  });

  it("AC-013.1 index.html links the manifest, the iOS icon and the app name", () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(pngSize("/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-title" content="TCGrass" />');
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(indexHtml).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`);
  });

  it("NFR-001 index.html has no inline script, so the CSP (script-src 'self') holds", () => {
    const scripts = indexHtml.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toMatch(/\ssrc="/);
    }
  });

  it("AC-013.1 ships the service worker at the root so its scope is the whole app", () => {
    expect(existsSync(repoPath("web/public/sw.js"))).toBe(true);
  });
});
