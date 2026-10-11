import { useState } from "preact/hooks";

import type { PublicPlayer } from "../../src/shared/schemas/players.js";
import { Icon } from "./Icon.js";

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
      <p class="card-category">{player.displayName}, your friend code</p>
      <strong class="friend-code">{player.friendCode}</strong>
      <div class="profile-actions">
        {typeof navigator.share === "function" && (
          <button
            type="button"
            onClick={() => {
              navigator.share({ text: shareText }).catch(() => undefined);
            }}
          >
            <Icon name="share" size={20} />
            Share
          </button>
        )}
        <button type="button" class="secondary" onClick={() => void copy()}>
          <Icon name={copied ? "check" : "copy"} size={20} />
          {copied ? "Copied!" : "Copy code"}
        </button>
      </div>
    </section>
  );
}
