export interface PlatformInfo {
  userAgent: string;
  maxTouchPoints: number;
  /** Safari's `navigator.standalone`: true when launched from the home screen. */
  standalone?: boolean | undefined;
  /** `matchMedia("(display-mode: standalone)").matches`. */
  displayModeStandalone: boolean;
}

/**
 * True in a browser tab on iOS/iPadOS. Installed and tab storage are separate there, so a
 * player created in the tab is lost after installing (AC-013.2).
 */
export function isIosBrowserTab(platform: PlatformInfo): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(platform.userAgent) ||
    // iPadOS reports a Mac user agent but has touch.
    (/Macintosh/.test(platform.userAgent) && platform.maxTouchPoints > 1);
  const installed = platform.standalone === true || platform.displayModeStandalone;
  return ios && !installed;
}
