// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Capture } from "../../web/src/Capture.js";

// jsdom has no canvas: the frame grab is a boundary, so it is faked.
vi.mock("../../web/src/capture-frame.js", () => ({
  captureFrame: () => Promise.resolve(new Blob(["jpeg"], { type: "image/jpeg" })),
}));

const card = {
  id: 1,
  cardId: "oak",
  name: "Oak",
  category: "tree",
  rarity: "common",
  flavorLine: "Older than the street it shades.",
  imageUrl: "/cards/everyday-nature/oak",
};

function fakeCamera() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    configurable: true,
  });
  return { stream, track };
}

beforeEach(() => {
  // Reduced motion: the reveal opens fully shown, so the test needn't wait out the entry.
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outcome: "card", card }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Capture screen", () => {
  it("AC-006.5 dismissing the reveal returns to the same live camera preview", async () => {
    const { stream, track } = fakeCamera();
    const { container } = render(
      <Capture secret="s3cret" onUnauthenticated={vi.fn()} onLockedChange={vi.fn()} />,
    );
    const video = container.querySelector("video");
    if (video === null) throw new Error("no camera preview");
    await waitFor(() => {
      expect(video.srcObject).toBe(stream);
    });
    fireEvent(video, new Event("loadedmetadata"));

    fireEvent.click(await screen.findByRole("button", { name: /Capture/ }));
    expect(await screen.findByRole("dialog", { name: "Oak" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep exploring" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(container.querySelector("video")).toBe(video);
    expect(video.srcObject).toBe(stream);
    expect(track.stop).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Capture/ }).disabled).toBe(false);
  });
});
