import { downscaledSize } from "./size.js";

/** JPEG quality that keeps a 1024-px photo well under 1 MB (NFR-004). */
const JPEG_QUALITY = 0.85;

/**
 * Draws the current camera frame on a canvas at most 1024 px on the long edge and encodes it
 * as JPEG (AC-003.3). Re-encoding also drops any EXIF/GPS metadata.
 */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    return Promise.reject(new Error("The camera has no frame yet"));
  }
  const size = downscaledSize({ width: video.videoWidth, height: video.videoHeight });
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (context === null) {
    return Promise.reject(new Error("Canvas 2D is not available"));
  }
  context.drawImage(video, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error("Could not encode the photo"));
        } else {
          resolve(blob);
        }
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
