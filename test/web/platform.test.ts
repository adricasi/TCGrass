import { describe, expect, it } from "vitest";

import { isIosBrowserTab, type PlatformInfo } from "../../web/src/platform.js";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_MODE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

function platform(overrides: Partial<PlatformInfo>): PlatformInfo {
  return {
    userAgent: IPHONE_SAFARI,
    maxTouchPoints: 5,
    displayModeStandalone: false,
    ...overrides,
  };
}

describe("isIosBrowserTab", () => {
  it("AC-013.2 shows the install hint in an iPhone Safari tab", () => {
    expect(isIosBrowserTab(platform({}))).toBe(true);
  });

  it("AC-013.2 shows it on iPadOS, which reports a Mac user agent with touch", () => {
    expect(isIosBrowserTab(platform({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 5 }))).toBe(
      true,
    );
  });

  it.each([
    ["installed on iOS (navigator.standalone)", platform({ standalone: true })],
    ["installed (display-mode standalone)", platform({ displayModeStandalone: true })],
    ["a real Mac without touch", platform({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 0 })],
    ["Android Chrome", platform({ userAgent: ANDROID_CHROME })],
  ])("AC-013.2 does not show it when %s", (_label, info) => {
    expect(isIosBrowserTab(info)).toBe(false);
  });
});
