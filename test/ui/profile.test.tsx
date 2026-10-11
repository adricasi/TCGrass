// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Profile } from "../../web/src/Profile.js";

const player = { displayName: "Adri", friendCode: "ABCD2345" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Profile", () => {
  it("AC-008.1 shows the friend code and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Profile player={player} />);

    expect(screen.getByText("ABCD2345")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("ABCD2345");
  });

  it("AC-008.1 offers the share sheet with the code where the browser has one", () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    render(<Profile player={player} />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({
      text: "Add me on TCGrass! My friend code is ABCD2345",
    });
  });
});
