import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pollWhileVisible, type VisibilitySource } from "../../web/src/poll.js";

function fakeDocument(initial: "visible" | "hidden") {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial as string,
    addEventListener: (_type: "visibilitychange", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "visibilitychange", listener: () => void) =>
      listeners.delete(listener),
    set(state: "visible" | "hidden") {
      doc.visibilityState = state;
      listeners.forEach((listener) => {
        listener();
      });
    },
    listeners,
  };
  return doc satisfies VisibilitySource;
}

describe("pollWhileVisible", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC-010.1 refreshes now and every 20 s while the app is visible", () => {
    const refresh = vi.fn();
    pollWhileVisible(refresh, 20_000, fakeDocument("visible"));
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("AC-010.1 pauses while hidden and refreshes as soon as the app is visible again", () => {
    const refresh = vi.fn();
    const doc = fakeDocument("visible");
    pollWhileVisible(refresh, 20_000, doc);
    doc.set("hidden");
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    doc.set("visible");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("AC-010.1 does not poll when started hidden, and stops cleanly", () => {
    const refresh = vi.fn();
    const doc = fakeDocument("hidden");
    const stop = pollWhileVisible(refresh, 20_000, doc);
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    stop();
    expect(doc.listeners.size).toBe(0);
    doc.set("visible");
    expect(refresh).not.toHaveBeenCalled();
  });
});
