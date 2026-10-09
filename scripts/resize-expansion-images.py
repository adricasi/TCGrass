"""Resize and compress expansion card art to -resize 768x1024^ and ~300KB PNG."""

from __future__ import annotations

import io
import os
import subprocess
from PIL import Image

TARGET_DIRS = [
    r"expansion/everyday-nature/images",
    r"expansions/everyday-nature/images",
]

CARD_NAMES = [
    "birch",
    "cat",
    "chicken",
    "daisy",
    "dandelion",
    "dog",
    "fruit-tree",
    "geranium",
    "horse",
    "lavender",
    "oak",
    "palm",
    "pigeon",
    "pine",
    "rose",
]


def load_original(filename: str, local_path: str) -> Image.Image:
    # If the local file already has the pristine 1696x2528 size, use it directly
    if os.path.exists(local_path):
        im = Image.open(local_path)
        if im.size == (1696, 2528):
            return im

    # Otherwise fetch pristine original from git commit 32606d7
    try:
        data = subprocess.check_output(["git", "show", f"32606d7:images/{filename}"])
        return Image.open(io.BytesIO(data))
    except Exception:
        return Image.open(local_path)


def resize_and_compress(im: Image.Image) -> Image.Image:
    # ImageMagick -resize 768x1024^ equivalent (minimum fill preserving aspect ratio)
    orig_w, orig_h = im.size
    scale = max(768 / orig_w, 1024 / orig_h)
    new_w = round(orig_w * scale)
    new_h = round(orig_h * scale)

    resized = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
    return resized.quantize(colors=256, method=Image.Quantize.FASTOCTREE)


def main() -> None:
    for target_dir in TARGET_DIRS:
        os.makedirs(target_dir, exist_ok=True)
        print(f"Processing images into {target_dir}:")
        for name in CARD_NAMES:
            filename = f"{name}.png"
            out_path = os.path.join(target_dir, filename)
            original = load_original(filename, out_path)
            processed = resize_and_compress(original)
            processed.save(out_path, format="PNG", optimize=True)
            size_kb = os.path.getsize(out_path) / 1024
            print(f"  {filename:<15} size={processed.size} file_size={size_kb:.1f} KB")


if __name__ == "__main__":
    main()
