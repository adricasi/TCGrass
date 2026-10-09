import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ExpansionError, parseExpansionYaml } from "../../src/server/expansion/parse.js";

const everydayNature = readFileSync(
  new URL("../../expansions/everyday-nature/expansion.yaml", import.meta.url),
  "utf8",
);

const minimal = `
id: tiny
name: Tiny
version: 0.1.0
license: { data: Apache-2.0, images: CC0 }
rarity_odds: { common: 70, rare: 22, epic: 7, legendary: 1 }
style_prompt: Watercolour.
identification: { instructions: Pick one card. }
cards:
  - { id: oak, name: Oak, category: tree, identify_hint: Lobed leaves., art_prompt: An oak. }
  - { id: rose, name: Rose, category: flower, identify_hint: Spiral petals., art_prompt: A rose. }
`;

describe("parseExpansionYaml", () => {
  it("parses the everyday-nature expansion with 15 cards", () => {
    const expansion = parseExpansionYaml(everydayNature);
    expect(expansion.id).toBe("everyday-nature");
    expect(expansion.cards).toHaveLength(15);
  });

  it("AC-001.2 rejects odds that do not sum to 100", () => {
    const text = minimal.replace("legendary: 1", "legendary: 2");
    expect(() => parseExpansionYaml(text)).toThrow(/sum to exactly 100/);
  });

  it("AC-001.2 rejects non-integer odds and names the rarity", () => {
    const text = minimal
      .replace("common: 70", "common: 69.5")
      .replace("legendary: 1", "legendary: 1.5");
    expect(() => parseExpansionYaml(text)).toThrow(/rarity_odds\.common/);
  });

  it("AC-001.3 rejects duplicate card ids and names the card", () => {
    const text = minimal.replace("id: rose", "id: oak");
    expect(() => parseExpansionYaml(text)).toThrow(/cards\.1\.id: duplicate card id "oak"/);
  });

  it("AC-001.3 rejects a card id that is not lowercase letters, digits and hyphens", () => {
    const text = minimal.replace("id: rose", "id: Red_Rose");
    expect(() => parseExpansionYaml(text)).toThrow(/cards\.1\.id/);
  });

  it.each(["none", "screen"])("AC-001.3 rejects the reserved card id %j", (id) => {
    const text = minimal.replace("id: rose", `id: ${id}`);
    expect(() => parseExpansionYaml(text)).toThrow(/cards\.1\.id: is reserved/);
  });

  it("AC-001.3 rejects an empty identify_hint and names the card and field", () => {
    const text = minimal.replace("identify_hint: Spiral petals.", "identify_hint: ''");
    expect(() => parseExpansionYaml(text)).toThrow(/cards\.1\.identify_hint/);
  });

  it("rejects text that is not YAML", () => {
    expect(() => parseExpansionYaml("cards: [unclosed")).toThrow(ExpansionError);
  });
});
