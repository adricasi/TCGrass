import { describe, expect, it } from "vitest";

import { downscaledSize, MAX_PHOTO_EDGE_PX } from "../../web/src/size.js";

describe("downscaledSize", () => {
  it.each([
    [
      { width: 4032, height: 3024 },
      { width: 1024, height: 768 },
    ],
    [
      { width: 3024, height: 4032 },
      { width: 768, height: 1024 },
    ],
    [
      { width: 1920, height: 1080 },
      { width: 1024, height: 576 },
    ],
    [
      { width: 4000, height: 4000 },
      { width: 1024, height: 1024 },
    ],
    [
      { width: 1025, height: 10 },
      { width: 1024, height: 10 },
    ],
  ])("AC-003.3 scales %o down to a long edge of 1024 px: %o", (source, expected) => {
    const size = downscaledSize(source);
    expect(size).toEqual(expected);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_PHOTO_EDGE_PX);
  });

  it.each([
    { width: 1024, height: 768 },
    { width: 640, height: 480 },
  ])("AC-003.3 keeps a frame of %o as it is (no upscaling)", (source) => {
    expect(downscaledSize(source)).toEqual(source);
  });

  it("AC-003.3 never returns a zero-pixel edge for extreme aspect ratios", () => {
    expect(downscaledSize({ width: 100_000, height: 20 })).toEqual({ width: 1024, height: 1 });
  });
});
