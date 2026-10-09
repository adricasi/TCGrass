/** Longest edge of an uploaded photo, in pixels (AC-003.3). */
export const MAX_PHOTO_EDGE_PX = 1024;

export interface Size {
  width: number;
  height: number;
}

/**
 * Size to draw a camera frame at so its long edge is at most `maxEdge`, keeping the aspect
 * ratio. Smaller frames are never upscaled.
 */
export function downscaledSize(source: Size, maxEdge = MAX_PHOTO_EDGE_PX): Size {
  const longEdge = Math.max(source.width, source.height);
  if (longEdge <= maxEdge) {
    return { width: source.width, height: source.height };
  }
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}
