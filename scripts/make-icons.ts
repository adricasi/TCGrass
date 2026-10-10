/**
 * Draws the app icon (a card with grass blades on green) and writes the PNGs the manifest and
 * iOS need into web/public/ (T-013, AC-013.1). No image dependencies: shapes are rasterised
 * with 4×4 supersampling and encoded with node:zlib. The card stays inside the maskable safe
 * zone (a centred circle of radius 0.4), so the same image serves as the maskable icon.
 *
 *   node --import tsx scripts/make-icons.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

type Rgb = readonly [number, number, number];

const BACKGROUND: Rgb = [0x14, 0x53, 0x2d];
const CARD: Rgb = [0xf5, 0xf0, 0xe1];
const ART: Rgb = [0xbb, 0xf7, 0xd0];
const GRASS: Rgb = [0x15, 0x80, 0x3d];
const RARITY_BAR: Rgb = [0xca, 0x8a, 0x04];

type Point = readonly [number, number];

function inRoundedRect(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number,
): boolean {
  if (x < left || x > right || y < top || y > bottom) {
    return false;
  }
  const cornerX = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cornerY = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  return (x - cornerX) ** 2 + (y - cornerY) ** 2 <= radius ** 2;
}

function inTriangle(x: number, y: number, [a, b, c]: readonly [Point, Point, Point]): boolean {
  const side = (p: Point, q: Point) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
  const d1 = side(a, b);
  const d2 = side(b, c);
  const d3 = side(c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

const BLADES: readonly (readonly [Point, Point, Point])[] = [
  [
    [0.36, 0.62],
    [0.44, 0.62],
    [0.4, 0.38],
  ],
  [
    [0.44, 0.62],
    [0.54, 0.62],
    [0.5, 0.31],
  ],
  [
    [0.53, 0.62],
    [0.62, 0.62],
    [0.6, 0.41],
  ],
];

/** Colour at a point of the unit square. */
function colorAt(x: number, y: number): Rgb {
  if (!inRoundedRect(x, y, 0.3, 0.24, 0.7, 0.78, 0.05)) {
    return BACKGROUND;
  }
  if (x >= 0.34 && x <= 0.66 && y >= 0.29 && y <= 0.62) {
    return BLADES.some((blade) => inTriangle(x, y, blade)) ? GRASS : ART;
  }
  if (x >= 0.38 && x <= 0.62 && y >= 0.68 && y <= 0.71) {
    return RARITY_BAR;
  }
  return CARD;
}

const SAMPLES = 4;

function render(size: number): Buffer {
  // One filter byte (0 = none) before each row of RGBA pixels.
  const rowBytes = 1 + size * 4;
  const raw = Buffer.alloc(rowBytes * size);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [r, g, b] = colorAt(
            (column + (sx + 0.5) / SAMPLES) / size,
            (row + (sy + 0.5) / SAMPLES) / size,
          );
          red += r;
          green += g;
          blue += b;
        }
      }
      const offset = row * rowBytes + 1 + column * 4;
      raw[offset] = Math.round(red / SAMPLES ** 2);
      raw[offset + 1] = Math.round(green / SAMPLES ** 2);
      raw[offset + 2] = Math.round(blue / SAMPLES ** 2);
      raw[offset + 3] = 255;
    }
  }
  return encodePng(size, raw);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size: number, raw: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outputs: readonly (readonly [string, number])[] = [
  ["web/public/icons/icon-192.png", 192],
  ["web/public/icons/icon-512.png", 512],
  ["web/public/apple-touch-icon.png", 180],
];

mkdirSync("web/public/icons", { recursive: true });
for (const [path, size] of outputs) {
  writeFileSync(path, render(size));
  console.log(`wrote ${path} (${size}×${size})`);
}
