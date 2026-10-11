import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RARITIES } from "../../src/shared/expansion.js";
import {
  ENTRY_FALLBACK_MS,
  cardClass,
  entryAnimation,
  isEntryAnimation,
  revealClass,
} from "../../web/src/reveal-entry.js";
import { repoPath } from "../server/helpers.js";

const css = readFileSync(repoPath("web/src/style.css"), "utf8");

/** Body of the first top-level rule whose selector list is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (match?.[1] === undefined) throw new Error(`no rule for ${selector}`);
  return match[1];
}

/** Sum of every time value in an `animation` shorthand: duration plus delay, in ms. */
function animationTotalMs(declarations: string): number {
  const animation = /animation:\s*([^;]+);/.exec(declarations)?.[1];
  if (animation === undefined) throw new Error("no animation declaration");
  return [...animation.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)].reduce(
    (total, [, value, unit]) => total + Number(value) * (unit === "s" ? 1000 : 1),
    0,
  );
}

function keyframesName(declarations: string): string {
  const animation = /animation:\s*([^;]+);/.exec(declarations)?.[1] ?? "";
  const name = animation.split(/\s+/).find((token) => css.includes(`@keyframes ${token} `));
  if (name === undefined) throw new Error(`no @keyframes for "${animation}"`);
  return name;
}

describe("reveal entry animation", () => {
  it("AC-006.6 Epic and Legendary use a different entry animation from Common and Rare", () => {
    const classes = RARITIES.map((rarity) => entryAnimation(rarity, false));
    expect(classes[0]).toBe(classes[1]);
    expect(classes[2]).toBe(classes[3]);
    expect(classes[0]).not.toBe(classes[2]);
    expect(classes.every((name) => name !== null)).toBe(true);
  });

  it("AC-006.6 each entry class has its own keyframes, at most 2,000 ms including delay", () => {
    const standard = ruleBody(css, `.reveal-entering .${entryAnimation("common", false)}`);
    const foil = ruleBody(css, `.reveal-entering .${entryAnimation("epic", false)}`);
    expect(keyframesName(standard)).not.toBe(keyframesName(foil));
    for (const body of [standard, foil]) {
      const total = animationTotalMs(body);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(2000);
    }
  });

  it("AC-006.6 the fallback ends the entry when the longest animation does, within 2,000 ms", () => {
    const standard = ruleBody(css, `.reveal-entering .${entryAnimation("rare", false)}`);
    const foil = ruleBody(css, `.reveal-entering .${entryAnimation("legendary", false)}`);
    expect(ENTRY_FALLBACK_MS).toBe(Math.max(animationTotalMs(standard), animationTotalMs(foil)));
    expect(ENTRY_FALLBACK_MS).toBeLessThanOrEqual(2000);
  });

  it("AC-006.6 entry keyframes run only under .reveal-entering, so leaving it jumps to the end", () => {
    expect(revealClass(true).split(" ")).toContain("reveal-entering");
    expect(revealClass(false).split(" ")).not.toContain("reveal-entering");
    const entryRules = [...css.matchAll(/(?:^|\n)([^{}\n]*)\{[^}]*animation:\s*entry-/g)];
    expect(entryRules.length).toBe(2);
    for (const [, selector] of entryRules) expect(selector).toMatch(/^\.reveal-entering /);
  });

  it("AC-006.6 a tap during the entry can't dismiss: the dismiss button is hidden until it ends", () => {
    expect(ruleBody(css, ".reveal-entering .dismiss")).toMatch(/visibility:\s*hidden/);
  });

  it("AC-006.6 only the entry keyframes end the entry, not the infinite foil sweep", () => {
    expect(isEntryAnimation(entryAnimation("common", false) ?? "")).toBe(true);
    expect(isEntryAnimation(entryAnimation("epic", false) ?? "")).toBe(true);
    expect(isEntryAnimation("foil-sweep")).toBe(false);
  });

  it("AC-006.1 AC-006.2 the card keeps its frame and foil classes with or without the entry", () => {
    expect(cardClass("epic", "entry-foil")).toBe("card frame-epic foil entry-foil");
    expect(cardClass("common", null)).toBe("card frame-common");
  });

  it("AC-006.6 reduced motion shows no entry animation", () => {
    for (const rarity of RARITIES) expect(entryAnimation(rarity, true)).toBeNull();
  });

  it("AC-006.6 reduced motion disables entry keyframes and the foil sweep in the stylesheet", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
    expect(reduced).toBeDefined();
    expect(reduced).toMatch(/\.foil::after\s*\{[^}]*animation:\s*none/);
    expect(reduced).toMatch(/\.reveal-entering [^{]*\{[^}]*animation:\s*none/);
  });
});
