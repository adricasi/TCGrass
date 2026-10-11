import { useEffect, useRef, useState } from "preact/hooks";

import type { CapturedCard, CaptureResponse } from "../../src/shared/schemas/captures.js";
import { ApiError, postCapture } from "./api.js";
import { captureFrame } from "./capture-frame.js";
import {
  describeCaptureError,
  describeCooldown,
  SLOW_CAPTURE_MS,
  SLOW_CAPTURE_TEXT,
} from "./capture-messages.js";
import { Icon } from "./Icon.js";
import { Reveal } from "./Reveal.js";

type CameraState = "starting" | "ready" | "denied" | "busy-elsewhere" | "insecure" | "unavailable";

/** Messages for captures that mint nothing (AC-003.6, AC-003.7, AC-003.9). */
const RESULT_TEXT: Record<Exclude<CaptureResponse["outcome"], "card" | "cooldown">, string> = {
  none: "No card here — try something else",
  screen: "That looks like a screen or a picture. Photograph the real thing!",
  retry: "The card spirits didn't answer in time. Try again.",
};

function cameraStateFor(error: unknown): CameraState {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "denied";
  }
  return name === "NotReadableError" ? "busy-elsewhere" : "unavailable";
}

/**
 * Capture screen: live camera preview and shutter only. There is deliberately no file upload
 * fallback, so cards come from the real world (AC-003.1, AC-003.2).
 */
export function Capture({
  secret,
  onUnauthenticated,
  onLockedChange,
}: {
  secret: string;
  /** The server no longer knows this player (AC-002.7). */
  onUnauthenticated: () => void;
  /**
   * True while a capture is in flight or a reveal is open: leaving the screen then would
   * mint a card the player never sees (AC-006.1).
   */
  onLockedChange: (locked: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<CapturedCard | null>(null);
  const [slow, setSlow] = useState(false);

  // Captures usually take ~10 s and up to 30 s (NFR-004): say so once one takes a while.
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => {
      setSlow(true);
    }, SLOW_CAPTURE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [busy]);

  useEffect(() => {
    onLockedChange(busy || revealed !== null);
  }, [busy, revealed]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    if (!window.isSecureContext) {
      // Browsers only offer the camera on https:// (or localhost).
      setCamera("insecure");
      return;
    }
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      setCamera("unavailable");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((media) => {
        stream = media;
        if (cancelled || videoRef.current === null) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        // Ready only once frames have a size; an early tap would capture a 0x0 image.
        video.addEventListener(
          "loadedmetadata",
          () => {
            setCamera("ready");
          },
          { once: true },
        );
        video.srcObject = media;
      })
      .catch((error: unknown) => {
        setCamera(cameraStateFor(error));
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function takePhoto(): Promise<void> {
    const video = videoRef.current;
    if (video === null || busy) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await postCapture(secret, await captureFrame(video));
      if (result.outcome === "card") {
        setRevealed(result.card);
      } else if (result.outcome === "cooldown") {
        setMessage(describeCooldown(result.cooldown));
      } else {
        setMessage(RESULT_TEXT[result.outcome]);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      setMessage(describeCaptureError(error));
    } finally {
      setBusy(false);
    }
  }

  if (camera === "denied") {
    return (
      <section class="notice" role="alert">
        <h2>Camera access is blocked</h2>
        <p>
          TCGrass needs your camera to find cards in the real world. Allow the camera for this site
          in your browser settings (tap the lock or ⓘ icon next to the address, then Camera → Allow)
          and reload the page.
        </p>
      </section>
    );
  }
  if (camera === "busy-elsewhere") {
    return (
      <section class="notice" role="alert">
        <h2>The camera is in use</h2>
        <p>Another app is using the camera. Close it and reload this page.</p>
      </section>
    );
  }
  if (camera === "insecure") {
    return (
      <section class="notice" role="alert">
        <h2>Secure connection needed</h2>
        <p>The camera only works over https://. Open the game's https:// address.</p>
      </section>
    );
  }
  if (camera === "unavailable") {
    return (
      <section class="notice" role="alert">
        <h2>No camera available</h2>
        <p>TCGrass needs a camera. Open this page on a phone with a camera, in Chrome or Safari.</p>
      </section>
    );
  }

  return (
    <section class="capture">
      <div class="viewfinder">
        <video ref={videoRef} class="preview" autoplay playsInline muted />
      </div>
      <p class="capture-hint">Find a flower, a tree or an animal</p>
      <button
        type="button"
        class="shutter"
        disabled={camera !== "ready" || busy || revealed !== null}
        onClick={() => void takePhoto()}
      >
        {!busy && <Icon name="camera" />}
        {busy ? (slow ? SLOW_CAPTURE_TEXT : "Looking…") : "Capture"}
      </button>
      <p class="result" aria-live="polite">
        {message}
      </p>
      {/* The camera stays mounted under the reveal, so dismissing returns to it (AC-006.5). */}
      {revealed !== null && (
        <Reveal
          card={revealed}
          onDismiss={() => {
            setRevealed(null);
          }}
        />
      )}
    </section>
  );
}
