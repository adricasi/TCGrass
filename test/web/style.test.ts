import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../server/helpers.js";

const css = readFileSync(repoPath("web/src/style.css"), "utf8");

function fontFaces(): { family: string; file: string }[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body = ""]) => {
    const family = /font-family:\s*"([^"]+)"/.exec(body)?.[1];
    const file = /url\("\.\/assets\/fonts\/([^"]+\.woff2)"\)/.exec(body)?.[1];
    if (family === undefined || file === undefined) throw new Error(`bad @font-face: ${body}`);
    return { family, file };
  });
}

describe("Field Journal stylesheet (T-024, ADR 0009)", () => {
  it("NFR-010 self-hosts every font, each with its OFL licence next to it", () => {
    const faces = fontFaces();
    expect(new Set(faces.map((face) => face.family))).toEqual(
      new Set(["Fraunces", "Figtree", "Caveat"]),
    );
    for (const face of faces) {
      expect(existsSync(repoPath(`web/src/assets/fonts/${face.file}`))).toBe(true);
      const licence = repoPath(`web/src/assets/fonts/OFL-${face.family.toLowerCase()}.txt`);
      expect(readFileSync(licence, "utf8")).toContain("SIL OPEN FONT LICENSE");
    }
  });

  it("NFR-010 loads nothing from other origins (CSP 'self')", () => {
    expect(css).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
    expect(css).not.toMatch(/@import/);
  });

  it("AC-007.1 shows missing cards as dark silhouettes", () => {
    expect(css).toMatch(/\.binder-card\.missing img\s*\{[^}]*filter:\s*brightness\(0\)/);
  });

  it("AC-006.6 turns off transitions and animations under reduced motion", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\*,[\s\S]*?transition:\s*none/,
    );
  });
});
