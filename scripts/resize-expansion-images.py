"""Resize and compress an expansion's card art for phones (design.md § Expansion file).

Scales every PNG to 768 px wide (keeping its aspect ratio, so 2:3 art becomes about
768 x 1152) and reduces it to a 256-colour palette, which keeps each card around 300 KB.

Usage:
    python3 scripts/resize-expansion-images.py <expansion-dir> [--source <dir>]

Reads <dir>/*.png (default: <expansion-dir>/images) and writes
<expansion-dir>/images/<name>.png. Images already 768 px wide or narrower are left as they
are, so running it twice does not degrade them. Needs Pillow (`pip install pillow`); it is a
helper for expansion authors, not part of the app.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install pillow")

TARGET_WIDTH = 768


def resize_and_compress(image: Image.Image) -> Image.Image:
    scale = TARGET_WIDTH / image.width
    resized = image.resize(
        (TARGET_WIDTH, round(image.height * scale)), Image.Resampling.LANCZOS
    )
    return resized.convert("RGBA").quantize(colors=256, method=Image.Quantize.FASTOCTREE)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("expansion_dir", type=Path)
    parser.add_argument("--source", type=Path, help="folder with the original PNGs")
    args = parser.parse_args()

    target = args.expansion_dir / "images"
    source = args.source or target
    originals = sorted(source.glob("*.png"))
    if not originals:
        print(f"No PNG files in {source}", file=sys.stderr)
        return 1

    target.mkdir(parents=True, exist_ok=True)
    for original in originals:
        out_path = target / original.name
        with Image.open(original) as image:
            if image.width <= TARGET_WIDTH:
                print(f"  {original.name:<18} kept ({image.width}x{image.height})")
                continue
            processed = resize_and_compress(image)
        processed.save(out_path, format="PNG", optimize=True)
        size_kb = out_path.stat().st_size / 1024
        print(f"  {original.name:<18} {processed.width}x{processed.height}  {size_kb:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
