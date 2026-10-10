import { describe, expect, it } from "vitest";

import { createApp } from "../../src/server/app.js";
import { respondToFriendRequest, sendFriendRequest } from "../../src/server/game/friends.js";
import type { Identification, Identifier } from "../../src/server/identify/client.js";
import { createPlayer, type CreatedPlayer } from "../../src/server/players/service.js";
import { captureResponseSchema } from "../../src/shared/schemas/captures.js";
import {
  fakeIdentifier,
  JPEG_BYTES,
  memoryLog,
  photoForm,
  seededDb,
  testApp,
  type TestApp,
  type TestAppOptions,
} from "./helpers.js";

const HOUR_MS = 60 * 60 * 1000;
const T0 = new Date("2026-10-11T08:00:00.000Z");

function identified(cardId: string): Identification {
  return { outcome: "card", cardId, confidence: 0.9, flavorLine: null };
}

/** A clock the test moves forward by hand. */
function fakeClock(start = T0) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** Answers with whatever card `next` names, so one app can identify different subjects. */
function switchableIdentifier(first: string) {
  let next = first;
  const { identify } = fakeIdentifier(() => Promise.resolve(identified(next)));
  return {
    identify,
    show: (cardId: string) => {
      next = cardId;
    },
  };
}

function cooldownApp(identify: Identifier, clock = fakeClock(), options: TestAppOptions = {}) {
  const t = testApp(identify, { captureCooldownHours: 5, now: clock.now, ...options });
  return { t, clock };
}

async function capture(t: Pick<TestApp, "app" | "auth">, auth = t.auth) {
  const response = await t.app.request("/api/captures", {
    method: "POST",
    headers: auth,
    body: photoForm(JPEG_BYTES),
  });
  expect(response.status).toBe(200);
  return captureResponseSchema.parse(await response.json());
}

function instanceCount(t: TestApp, ownerId?: number): number {
  const row =
    ownerId === undefined
      ? t.db.prepare<[], { n: number }>("SELECT count(*) AS n FROM card_instances").get()
      : t.db
          .prepare<[number], { n: number }>(
            "SELECT count(*) AS n FROM card_instances WHERE owner_id = ?",
          )
          .get(ownerId);
  return row?.n ?? 0;
}

function bearer(player: CreatedPlayer): Record<string, string> {
  return { authorization: `Bearer ${player.secret}` };
}

describe("capture cooldown (REQ-014)", () => {
  it("AC-014.1 refuses a second capture of the same card within the cooldown and says when", async () => {
    let rolls = 0;
    const { t, clock } = cooldownApp(fakeIdentifier(identified("oak")).identify, fakeClock(), {
      random: () => {
        rolls += 1;
        return 0;
      },
    });
    expect((await capture(t)).outcome).toBe("card");

    clock.advance(5 * HOUR_MS - 1000);
    const second = await capture(t);

    expect(second).toEqual({
      outcome: "cooldown",
      cooldown: {
        cardId: "oak",
        name: "Oak",
        availableAt: new Date(T0.getTime() + 5 * HOUR_MS).toISOString(),
      },
    });
    expect(instanceCount(t)).toBe(1);
    expect(rolls).toBe(1); // no rarity roll for the refused capture
  });

  it("AC-014.1 allows the capture again exactly when the cooldown ends", async () => {
    const { t, clock } = cooldownApp(fakeIdentifier(identified("oak")).identify);
    await capture(t);
    clock.advance(5 * HOUR_MS);

    expect((await capture(t)).outcome).toBe("card");
    expect(instanceCount(t)).toBe(2);
  });

  it("AC-014.1 a refused capture does not extend the cooldown", async () => {
    const { t, clock } = cooldownApp(fakeIdentifier(identified("oak")).identify);
    await capture(t);
    clock.advance(4 * HOUR_MS);
    expect((await capture(t)).outcome).toBe("cooldown");

    clock.advance(HOUR_MS);
    expect((await capture(t)).outcome).toBe("card");
  });

  it("AC-014.4 a decimal cooldown ends on a whole millisecond", async () => {
    const { t, clock } = cooldownApp(fakeIdentifier(identified("oak")).identify, fakeClock(), {
      captureCooldownHours: 8.3,
    });
    await capture(t);
    const refused = await capture(t);
    if (refused.outcome !== "cooldown") {
      throw new Error("expected a cooldown");
    }
    const availableAt = Date.parse(refused.cooldown.availableAt);
    expect(availableAt - T0.getTime()).toBe(29_880_000);

    clock.advance(availableAt - T0.getTime());
    expect((await capture(t)).outcome).toBe("card");
  });

  it("AC-014.2 starts a cooldown only for the captured card and only for that player", async () => {
    const model = switchableIdentifier("oak");
    const { t } = cooldownApp(model.identify);
    const other = createPlayer(t.db, "Other");
    await capture(t);

    model.show("rose");
    expect((await capture(t)).outcome).toBe("card");
    model.show("oak");
    expect((await capture(t, bearer(other))).outcome).toBe("card");
    expect((await capture(t)).outcome).toBe("cooldown");
  });

  it("AC-014.3 a card received in a trade starts no cooldown and changes none", async () => {
    const model = switchableIdentifier("oak");
    const { t, clock } = cooldownApp(model.identify);
    const ada = createPlayer(t.db, "Ada");
    const bob = createPlayer(t.db, "Bob");
    const request = sendFriendRequest(t.db, ada.id, bob.friendCode);
    respondToFriendRequest(t.db, bob.id, request.id, true);

    const bobOak = await capture(t, bearer(bob));
    model.show("rose");
    const adaRose = await capture(t, bearer(ada));
    if (bobOak.outcome !== "card" || adaRose.outcome !== "card") {
      throw new Error("setup captures should mint");
    }
    const cooldownsBefore = t.db
      .prepare("SELECT * FROM capture_cooldowns ORDER BY player_id")
      .all();

    const offer = await t.app.request("/api/trades", {
      method: "POST",
      headers: { ...bearer(ada), "content-type": "application/json" },
      body: JSON.stringify({
        offeredInstanceId: adaRose.card.id,
        requestedInstanceId: bobOak.card.id,
      }),
    });
    const { id: offerId } = (await offer.json()) as { id: number };
    const accept = await t.app.request(`/api/trades/${offerId}/accept`, {
      method: "POST",
      headers: bearer(bob),
    });
    expect(accept.status).toBe(200);
    expect(t.db.prepare("SELECT * FROM capture_cooldowns ORDER BY player_id").all()).toEqual(
      cooldownsBefore,
    );

    clock.advance(60 * 1000);
    model.show("oak");
    expect((await capture(t, bearer(ada))).outcome).toBe("card");
    model.show("rose");
    expect((await capture(t, bearer(bob))).outcome).toBe("card");
  });

  it("AC-014.4 a changed setting applies to cooldowns already running", async () => {
    const clock = fakeClock();
    const { db, expansion } = seededDb();
    const player = createPlayer(db, "Ada");
    const { identify } = fakeIdentifier(identified("oak"));
    const { logger } = memoryLog();
    const appWith = (captureCooldownHours: number) => ({
      app: createApp({ db, expansion, identify, logger, captureCooldownHours, now: clock.now }),
      auth: bearer(player),
    });
    const t5 = appWith(5);
    await capture(t5);

    clock.advance(HOUR_MS);
    expect((await capture(t5)).outcome).toBe("cooldown");
    // The admin lowers the cooldown to 1 h and restarts: the running cooldown is over.
    expect((await capture(appWith(1))).outcome).toBe("card");
  });

  it("AC-014.4 a cooldown of 0 turns it off", async () => {
    const { t } = cooldownApp(fakeIdentifier(identified("oak")).identify, fakeClock(), {
      captureCooldownHours: 0,
    });
    await capture(t);
    expect((await capture(t)).outcome).toBe("card");
    expect(instanceCount(t)).toBe(2);
  });

  it("AC-014.5 a capture refused by the cooldown still counts toward both daily caps", async () => {
    const { t } = cooldownApp(fakeIdentifier(identified("oak")).identify);
    await capture(t);
    await capture(t);

    const counts = t.db
      .prepare<[], { scope: string; n: number }>(
        "SELECT scope, n FROM daily_call_counts ORDER BY scope",
      )
      .all();
    expect(counts).toEqual([
      { scope: "all", n: 2 },
      { scope: "player:1", n: 2 },
    ]);
  });

  it("AC-014.6 two concurrent captures of the same card mint at most one", async () => {
    const releases: (() => void)[] = [];
    const { identify } = fakeIdentifier(
      () =>
        new Promise<Identification>((resolve) => {
          releases.push(() => resolve(identified("oak")));
        }),
    );
    const { t } = cooldownApp(identify);
    const first = capture(t);
    const second = capture(t);
    await expect.poll(() => releases.length).toBe(2);
    releases.forEach((release) => release());

    const outcomes = (await Promise.all([first, second])).map((body) => body.outcome).sort();
    expect(outcomes).toEqual(["card", "cooldown"]);
    expect(instanceCount(t)).toBe(1);
  });

  it("NFR-007 logs a refused capture with the outcome cooldown", async () => {
    const { t } = cooldownApp(fakeIdentifier(identified("oak")).identify);
    await capture(t);
    await capture(t);

    expect(t.log.lines.map((line) => JSON.parse(line) as unknown)).toContainEqual(
      expect.objectContaining({ event: "capture", outcome: "cooldown", cardId: "oak" }),
    );
  });
});
