import { useState } from "preact/hooks";

import type { PublicPlayer } from "../../src/shared/schemas/players.js";

/** The player's own friend code with copy and share (AC-008.1). */
export function Profile({ player }: { player: PublicPlayer }) {
  const [copied, setCopied] = useState(false);
  const shareText = `Add me on TCGrass! My friend code is ${player.friendCode}`;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(player.friendCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section class="profile">
      <p>
        {player.displayName}, your friend code is
        <strong class="friend-code"> {player.friendCode}</strong>
      </p>
      <button type="button" onClick={() => void copy()}>
        {copied ? "Copied!" : "Copy code"}
      </button>
      {typeof navigator.share === "function" && (
        <button
          type="button"
          onClick={() => {
            navigator.share({ text: shareText }).catch(() => undefined);
          }}
        >
          Share
        </button>
      )}
    </section>
  );
}
