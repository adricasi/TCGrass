/** The parts of `document` the poller needs; injectable for tests. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Calls `refresh` now and every `intervalMs` while the page is visible, and right away when it
 * becomes visible again (AC-010.1: the badge refreshes at least every 30 s while the app is
 * visible; a hidden tab doesn't poll). Returns a function that stops polling.
 */
export function pollWhileVisible(
  refresh: () => void,
  intervalMs: number,
  visibility: VisibilitySource,
): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const start = () => {
    if (timer === undefined) {
      refresh();
      timer = setInterval(refresh, intervalMs);
    }
  };
  const stop = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const onChange = () => {
    if (visibility.visibilityState === "visible") {
      start();
    } else {
      stop();
    }
  };
  visibility.addEventListener("visibilitychange", onChange);
  onChange();
  return () => {
    visibility.removeEventListener("visibilitychange", onChange);
    stop();
  };
}
