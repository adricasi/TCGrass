import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../src/server/db/connection.js";
import { migrate } from "../../src/server/db/migrate.js";
import { nextUtcMidnight, reserveModelCall } from "../../src/server/game/daily-caps.js";
import type { Identification } from "../../src/server/identify/client.js";
import { createPlayer } from "../../src/server/players/service.js";
import { errorResponseSchema } from "../../src/shared/schemas/errors.js";
import {
  emptyDb,
  fakeIdentifier,
  JPEG_BYTES,
  photoForm,
  playerAuth,
  testApp,
  type TestApp,
} from "./helpers.js";

const caps = { global: 3, perPlayer: 2 };
const noon = new Date("2026-10-10T12:00:00.000Z");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function count(t: TestApp, scope: string): number {
  return (
    (
      t.db.prepare("SELECT n FROM daily_call_counts WHERE scope = ?").get(scope) as
        { n: number } | undefined
    )?.n ?? 0
  );
}

async function capture(t: TestApp, auth = t.auth, form = photoForm(JPEG_BYTES)): Promise<Response> {
  return t.app.request("/api/captures", { method: "POST", headers: auth, body: form });
}

describe("reserveModelCall", () => {
  it("NFR-012 counts every reservation for the player and overall", () => {
    const db = emptyDb();
    const [a, b] = [createPlayer(db, "A"), createPlayer(db, "B")];
    expect(reserveModelCall(db, a.id, caps, noon)).toEqual({ ok: true });
    expect(reserveModelCall(db, b.id, caps, noon)).toEqual({ ok: true });
    const rows = db.prepare("SELECT scope, n FROM daily_call_counts ORDER BY scope").all();
    expect(rows).toEqual([
      { scope: "all", n: 2 },
      { scope: `player:${a.id}`, n: 1 },
      { scope: `player:${b.id}`, n: 1 },
    ]);
  });

  it("AC-003.14 refuses a player's call once they used their daily allowance, without counting it", () => {
    const db = emptyDb();
    const a = createPlayer(db, "A");
    reserveModelCall(db, a.id, caps, noon);
    reserveModelCall(db, a.id, caps, noon);
    expect(reserveModelCall(db, a.id, caps, noon)).toEqual({
      ok: false,
      cap: "player",
      resumesAt: "2026-10-11T00:00:00.000Z",
    });
    expect(db.prepare("SELECT n FROM daily_call_counts WHERE scope = 'all'").get()).toEqual({
      n: 2,
    });
  });

  it("AC-003.13 refuses every player's call once the global cap is used", () => {
    const db = emptyDb();
    const players = [createPlayer(db, "A"), createPlayer(db, "B"), createPlayer(db, "C")];
    for (const player of players) {
      expect(reserveModelCall(db, player.id, caps, noon).ok).toBe(true);
    }
    expect(reserveModelCall(db, createPlayer(db, "D").id, caps, noon)).toMatchObject({
      ok: false,
      cap: "global",
    });
  });

  it("AC-003.13 starts over at 00:00 UTC", () => {
    const db = emptyDb();
    const a = createPlayer(db, "A");
    reserveModelCall(db, a.id, caps, noon);
    reserveModelCall(db, a.id, caps, noon);
    expect(reserveModelCall(db, a.id, caps, new Date("2026-10-10T23:59:59.999Z")).ok).toBe(false);
    expect(reserveModelCall(db, a.id, caps, new Date("2026-10-11T00:00:00.000Z")).ok).toBe(true);
  });

  it("NFR-012 keeps the counts across a restart (they live in the DB)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tcgrass-caps-"));
    dirs.push(dir);
    const path = join(dir, "tcgrass.db");
    let db = openDatabase(path);
    migrate(db);
    const a = createPlayer(db, "A");
    reserveModelCall(db, a.id, caps, noon);
    reserveModelCall(db, a.id, caps, noon);
    db.close();
    db = openDatabase(path);
    expect(reserveModelCall(db, a.id, caps, noon)).toMatchObject({ ok: false, cap: "player" });
    db.close();
  });

  it("NFR-012 prunes counts older than 7 days", () => {
    const db = emptyDb();
    const a = createPlayer(db, "A");
    reserveModelCall(db, a.id, caps, new Date("2026-10-01T12:00:00.000Z"));
    reserveModelCall(db, a.id, caps, new Date("2026-10-10T12:00:00.000Z"));
    const days = db.prepare("SELECT DISTINCT day FROM daily_call_counts").all();
    expect(days).toEqual([{ day: "2026-10-10" }]);
  });

  it("AC-003.13 resumes at the next UTC midnight", () => {
    expect(nextUtcMidnight(new Date("2026-12-31T23:30:00.000Z"))).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("POST /api/captures with daily caps", () => {
  const screen: Identification = { outcome: "screen" };

  it("AC-003.13 answers 503 daily_limit with the resume time and doesn't call the model", async () => {
    const model = fakeIdentifier(screen);
    const t = testApp(model.identify, { dailyCaps: { global: 2, perPlayer: 10 } });
    const other = playerAuth(t.db, "Other");
    expect((await capture(t)).status).toBe(200);
    expect((await capture(t, other)).status).toBe(200);

    const refused = await capture(t);
    expect(refused.status).toBe(503);
    const error = errorResponseSchema.parse(await refused.json()).error;
    expect(error.code).toBe("daily_limit");
    expect(error.resumesAt).toMatch(/T00:00:00\.000Z$/);
    expect(model.photos).toHaveLength(2);
    expect(t.log.text()).toContain('"event":"daily_cap_reached","cap":"global"');
  });

  it("AC-003.14 refuses one player past their daily allowance while others still capture", async () => {
    const model = fakeIdentifier(screen);
    const t = testApp(model.identify, { dailyCaps: { global: 100, perPlayer: 2 } });
    await capture(t);
    await capture(t);
    const refused = await capture(t);
    expect(refused.status).toBe(503);
    expect(errorResponseSchema.parse(await refused.json()).error.code).toBe("daily_limit");
    expect((await capture(t, playerAuth(t.db, "Other"))).status).toBe(200);
    expect(model.photos).toHaveLength(3);
    // Logged once per player per day: the signal for spotting many players run by one person.
    await capture(t);
    const logged = t.log.lines.filter((line) => line.includes('"cap":"player"'));
    expect(logged).toHaveLength(1);
  });

  it("AC-003.13 doesn't count photos rejected before the model call", async () => {
    const model = fakeIdentifier(screen);
    const t = testApp(model.identify, { dailyCaps: { global: 1, perPlayer: 1 }, maxInFlight: 0 });
    expect((await capture(t)).status).toBe(503); // busy: no in-flight slot
    expect((await capture(t, t.auth, photoForm(new Uint8Array([1, 2, 3])))).status).toBe(415);
    expect(count(t, "all")).toBe(0);
  });

  it("AC-003.13 counts calls that end in retry (the model was called)", async () => {
    const t = testApp(fakeIdentifier({ outcome: "retry", reason: "timeout" }).identify, {
      dailyCaps: { global: 1, perPlayer: 5 },
    });
    expect(await (await capture(t)).json()).toEqual({ outcome: "retry" });
    expect((await capture(t)).status).toBe(503);
  });

  // Requests run one after another in this single process, so this checks the counting; the
  // IMMEDIATE transaction is what makes the reservation atomic in production.
  it("NFR-012 six simultaneous captures against a cap of 3 make exactly 3 model calls", async () => {
    const model = fakeIdentifier(screen);
    const t = testApp(model.identify, { dailyCaps: { global: 3, perPlayer: 10 } });
    const players = Array.from({ length: 6 }, (_unused, index) => playerAuth(t.db, `P${index}`));
    const statuses = (await Promise.all(players.map((auth) => capture(t, auth)))).map(
      (r) => r.status,
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(3);
    expect(model.photos).toHaveLength(3);
    expect(count(t, "all")).toBe(3);
  });

  it("NFR-012 logs the token usage the endpoint reported, per capture", async () => {
    const t = testApp(
      fakeIdentifier({
        outcome: "none",
        reason: "no-match",
        usage: { promptTokens: 1500, completionTokens: 80 },
      }).identify,
    );
    await capture(t);
    expect(t.log.text()).toContain('"usage":{"prompt":1500,"completion":80}');
  });
});
