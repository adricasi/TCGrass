import type { PlatformInfo } from "./platform.js";

/** Reads the browser's platform details for `isIosBrowserTab`. */
export function currentPlatform(): PlatformInfo {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: navigatorWithStandalone.standalone,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
  };
}
