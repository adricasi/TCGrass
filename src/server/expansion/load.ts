import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";

import type { Expansion } from "../../shared/expansion.js";
import { ExpansionError, parseExpansionYaml } from "./parse.js";

export interface LoadedCardImage {
  /** Absolute path of `images/<card id>.png`, or `<category>.svg` for a placeholder. */
  imagePath: string;
  isPlaceholder: boolean;
}

export interface LoadedExpansion {
  expansion: Expansion;
  images: Map<string, LoadedCardImage>;
  warnings: string[];
}

export interface LoadOptions {
  placeholders: boolean;
}

/**
 * Reads and validates `<dir>/expansion.yaml` and finds each card's image (AC-001.2–001.4).
 * Throws an ExpansionError naming every problem; nothing is stored here.
 */
export function loadExpansionFolder(directory: string, options: LoadOptions): LoadedExpansion {
  const root = resolve(directory);
  const file = join(root, "expansion.yaml");
  if (!existsSync(file)) {
    throw new ExpansionError(`No expansion.yaml in ${root}`);
  }
  const expansion = parseExpansionYaml(readFileSync(file, "utf8"));
  if (expansion.id !== basename(root)) {
    throw new ExpansionError(
      `id: "${expansion.id}" must equal the folder name "${basename(root)}"`,
    );
  }

  const imagesDir = join(root, "images");
  const imagesRoot = existsSync(imagesDir) ? realpathSync(imagesDir) + sep : undefined;
  const images = new Map<string, LoadedCardImage>();
  const missing: string[] = [];
  const warnings: string[] = [];
  for (const card of expansion.cards) {
    // Card ids are validated slugs, so the name cannot leave images/; checkImage makes sure
    // the file itself does not either (a symlink to the DB or .env would be served publicly).
    const png = join(imagesDir, `${card.id}.png`);
    if (existsSync(png)) {
      const problem = checkImage(png, imagesRoot);
      if (problem === undefined) {
        images.set(card.id, { imagePath: png, isPlaceholder: false });
      } else {
        missing.push(`cards.${card.id}: images/${card.id}.png ${problem}`);
      }
    } else if (options.placeholders) {
      images.set(card.id, { imagePath: `${card.category}.svg`, isPlaceholder: true });
      warnings.push(
        `cards.${card.id}: no images/${card.id}.png, using the ${card.category} placeholder`,
      );
    } else {
      missing.push(`cards.${card.id}: missing image images/${card.id}.png`);
    }
  }
  if (missing.length > 0) {
    throw new ExpansionError(
      `card images are invalid:\n- ${missing.join("\n- ")}\n(use --placeholders until the art exists)`,
    );
  }
  return { expansion, images, warnings };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Returns why an image file is not acceptable, or undefined if it is a real PNG in images/. */
function checkImage(path: string, imagesRoot: string | undefined): string | undefined {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return "must be a regular file, not a symlink";
  }
  if (imagesRoot === undefined || !realpathSync(path).startsWith(imagesRoot)) {
    return "must be inside the images folder";
  }
  const header = Buffer.alloc(PNG_SIGNATURE.length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  return PNG_SIGNATURE.every((byte, index) => header[index] === byte) ? undefined : "is not a PNG";
}
