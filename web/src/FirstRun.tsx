import { useState } from "preact/hooks";

import { DISPLAY_NAME_RULE, displayNameSchema } from "../../src/shared/schemas/players.js";
import { ApiError } from "./api.js";
import { currentPlatform } from "./current-platform.js";
import { isIosBrowserTab } from "./platform.js";

/**
 * First visit: install hint on iOS tabs (AC-013.2), the 16+ and photo notice (AC-002.1), and
 * the display name (AC-002.4, AC-002.10).
 */
export function FirstRun({ onCreate }: { onCreate: (displayName: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showInstallHint = isIosBrowserTab(currentPlatform());

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!displayNameSchema.safeParse(name).success) {
      setError(DISPLAY_NAME_RULE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="first-run" onSubmit={(event) => void submit(event)}>
      {showInstallHint && (
        <section class="notice" role="note">
          <h2>Install TCGrass first</h2>
          <p>
            On iPhone and iPad, tap Share → Add to Home Screen and open TCGrass from there. A player
            created in this browser tab does not carry over to the installed app.
          </p>
        </section>
      )}
      <section class="notice">
        <h2>Before you play</h2>
        <p>TCGrass is for ages 16 and up.</p>
        <p>Your photos are only used to identify the card and are deleted right after.</p>
        <label class="confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              setConfirmed(event.currentTarget.checked);
            }}
          />
          I am 16 or older and understand how photos are used.
        </label>
      </section>
      <label class="name">
        Your name
        <input
          type="text"
          value={name}
          maxLength={40}
          autoComplete="nickname"
          onInput={(event) => {
            setName(event.currentTarget.value);
          }}
        />
      </label>
      <p class="hint">{DISPLAY_NAME_RULE}</p>
      <button type="submit" disabled={!confirmed || busy}>
        {busy ? "Creating…" : "Start playing"}
      </button>
      <p class="error" role="alert">
        {error}
      </p>
    </form>
  );
}
