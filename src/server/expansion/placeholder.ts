const CATEGORY_COLORS: Record<string, string> = {
  tree: "#4f7d4a",
  flower: "#b5527a",
  animal: "#9a6b3f",
};
const DEFAULT_COLOR = "#5d6b7a";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Placeholder art for a card without an image (AC-001.4): a 3:4 SVG in the category's color
 * with the category name. Text is XML-escaped because expansion files are forkable input.
 */
export function placeholderSvg(category: string): string {
  const color = CATEGORY_COLORS[category] ?? DEFAULT_COLOR;
  const label = escapeXml(category);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">',
    `<rect width="768" height="1024" fill="${color}"/>`,
    '<rect x="48" y="48" width="672" height="928" rx="32" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="8"/>',
    `<text x="384" y="540" font-family="sans-serif" font-size="72" fill="#fff" text-anchor="middle">${label}</text>`,
    "</svg>",
  ].join("");
}
