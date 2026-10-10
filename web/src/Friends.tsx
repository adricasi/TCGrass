import { useEffect, useState } from "preact/hooks";

import type { Friend } from "../../src/shared/schemas/friends.js";
import { FRIEND_CODE_LENGTH, type PublicPlayer } from "../../src/shared/schemas/players.js";
import { ApiError, getFriends, sendFriendRequest } from "./api.js";
import { FriendBinder } from "./FriendBinder.js";
import { Profile } from "./Profile.js";

/** Friends: own code, add by code, the friends list, and each friend's binder (REQ-008). */
export function Friends({
  secret,
  player,
  onUnauthenticated,
}: {
  secret: string;
  player: PublicPlayer;
  onUnauthenticated: () => void;
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    getFriends(secret)
      .then((response) => {
        setFriends(response.friends);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          onUnauthenticated();
        } else {
          setFailed(true);
        }
      });
    // onUnauthenticated only flips App state; re-fetching on parent re-renders is not wanted.
  }, [secret]);

  async function add(event: Event): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendFriendRequest(secret, code);
      setMessage(`Request sent to ${result.player.displayName}.`);
      setCode("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      // Server messages for friend requests are written for players (AC-008.3, AC-008.4).
      setMessage(error instanceof ApiError ? error.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (open !== null) {
    return (
      <FriendBinder
        secret={secret}
        friendCode={open}
        onUnauthenticated={onUnauthenticated}
        onBack={() => {
          setOpen(null);
        }}
      />
    );
  }

  return (
    <section class="friends">
      <Profile player={player} />
      <form class="add-friend" onSubmit={(event) => void add(event)}>
        <label>
          Add a friend by code
          <input
            type="text"
            value={code}
            maxLength={FRIEND_CODE_LENGTH + 8}
            autoCapitalize="characters"
            autoComplete="off"
            spellcheck={false}
            onInput={(event) => {
              setCode(event.currentTarget.value);
            }}
          />
        </label>
        <button type="submit" disabled={busy || code.trim() === ""}>
          Send request
        </button>
        <p class="result" aria-live="polite">
          {message}
        </p>
      </form>
      <h2>Friends</h2>
      {failed && (
        <p role="alert">Couldn't load your friends. Check your connection and try again.</p>
      )}
      {friends === null && !failed && <p>Loading…</p>}
      {friends !== null && friends.length === 0 && (
        <p>No friends yet. Share your code, or add a friend's.</p>
      )}
      <ul class="friend-list">
        {friends?.map((friend) => (
          <li key={friend.friendCode}>
            <button
              type="button"
              onClick={() => {
                setOpen(friend.friendCode);
              }}
            >
              {friend.displayName}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
