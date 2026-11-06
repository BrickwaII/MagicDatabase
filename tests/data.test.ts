import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  approveGame,
  createDeck,
  createGame,
  getGame,
  listGames,
  rejectGame,
  StaleError,
  updateGame,
  upsertPlayer,
  type GameInput,
} from "@/lib/data";
import type { Db } from "@/lib/db";
import { auditLog, decks, games, winConditions } from "@/lib/db/schema";
import type { Player } from "@/lib/schema";
import { insertPlayers, resetDb, useTestDb } from "./helpers/db";

const henry: Player = { player_id: "henry", display_name: "Henry", email: "h@x.com", role: "admin", active: true };
const sam: Player = { player_id: "sam", display_name: "Sam", email: "s@x.com", role: "player", active: true };
const alex: Player = { player_id: "alex", display_name: "Alex", email: "a@x.com", role: "player", active: true };
const kim: Player = { player_id: "kim", display_name: "Kim", email: "k@x.com", role: "player", active: true };

let db: Db;
let gid: string;

beforeAll(async () => {
  db = await useTestDb();
});

beforeEach(async () => {
  gid = await resetDb(db);
  await insertPlayers(db, gid, [henry, sam, alex, kim]);
  await db.insert(winConditions).values({ groupId: gid, id: "combat", name: "Combat" });
  for (const [owner, name] of [["henry", "Tifa"], ["sam", "Tidus"], ["alex", "Kilo"], ["kim", "Tidus"]]) {
    const actor = [henry, sam, alex, kim].find((p) => p.player_id === owner)!;
    await createDeck({ owner_player_id: owner, name, colors: "wu", commanders: [{ role: "commander", typed_name: name }] }, actor);
  }
});

async function deckOf(owner: string) {
  const [row] = await db.select().from(decks).where(and(eq(decks.groupId, gid), eq(decks.ownerPlayerId, owner)));
  return row.id;
}

async function input(over: Partial<GameInput> = {}): Promise<GameInput> {
  return {
    date: "2026-03-01",
    result: "won",
    brackets: ["3"],
    win_conditions: ["combat"],
    seats: [
      { player_id: "sam", deck_id: await deckOf("sam"), is_winner: true },
      { player_id: "alex", deck_id: await deckOf("alex") },
      { player_id: "RANDOM", deck_id: "ignored" },
    ],
    ...over,
  };
}

describe("games", () => {
  it("queues a player's submission and auto-approves an admin's", async () => {
    const g1 = await createGame(await input(), sam);
    expect(g1.status).toBe("pending");
    expect(g1.seats[2]).toMatchObject({ player_id: "RANDOM", deck_id: "" });
    const g2 = await createGame(await input(), henry);
    expect(g2).toMatchObject({ status: "approved", approved_by: "henry" });
    // Round-trips through the database unchanged.
    expect(await getGame(g1.game_id)).toEqual(g1);
  });

  it("numbers games per day", async () => {
    const a = await createGame(await input(), henry);
    const b = await createGame(await input(), henry);
    const c = await createGame(await input({ date: "2026-03-02" }), henry);
    expect([a.day_game_no, b.day_game_no, c.day_game_no]).toEqual([1, 2, 1]);
    const moved = await updateGame(c.game_id, await input(), c.rev, henry);
    expect(moved.day_game_no).toBe(3);
  });

  it("validates winners, seats, duplicate players and dates", async () => {
    const base = await input();
    await expect(createGame({ ...base, seats: base.seats.slice(0, 2) }, sam)).rejects.toThrow(/at least 3/);
    await expect(createGame({ ...base, seats: base.seats.map((s) => ({ ...s, is_winner: false })) }, sam)).rejects.toThrow(/winner/);
    await expect(createGame({ ...base, seats: [base.seats[0], base.seats[0], base.seats[1]] }, sam)).rejects.toThrow(/once/);
    await expect(createGame({ ...base, date: "2026-02-30" }, sam)).rejects.toThrow(/date/);
    const draw = await createGame({ ...base, result: "draw" }, henry);
    expect(draw.seats.every((s) => !s.is_winner)).toBe(true);
    expect(draw.win_conditions).toEqual([]);
  });

  it("lets seated players edit, sends approved games back to the queue, and rejects stale saves", async () => {
    const g = await createGame(await input(), henry);
    await expect(updateGame(g.game_id, await input(), g.rev, kim)).rejects.toThrow(/games you played in/);
    const edited = await updateGame(g.game_id, await input({ notes: "fixed" }), g.rev, alex);
    expect(edited).toMatchObject({ status: "pending", notes: "fixed", rev: 2 });
    await expect(updateGame(g.game_id, await input(), g.rev, alex)).rejects.toBeInstanceOf(StaleError);
    expect((await getGame(g.game_id))!.seats).toHaveLength(3);
  });

  it("approves and rejects (admin only, reason required)", async () => {
    const g = await createGame(await input(), sam);
    await expect(approveGame(g.game_id, sam)).rejects.toThrow(/admins/);
    await expect(rejectGame(g.game_id, henry, " ")).rejects.toThrow(/reason/);
    await rejectGame(g.game_id, henry, "wrong date");
    expect((await getGame(g.game_id))!).toMatchObject({ status: "rejected", reject_reason: "wrong date" });
    await approveGame(g.game_id, henry);
    expect((await listGames({ status: "approved" })).map((x) => x.game_id)).toContain(g.game_id);
    const audit = (await db.select().from(auditLog).where(eq(auditLog.groupId, gid))).map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(["create", "reject", "approve"]));
  });
});

describe("rev conflicts", () => {
  it("refuses a save based on an older rev and leaves the stored game untouched", async () => {
    const g = await createGame(await input({ notes: "original" }), henry);
    // Someone approves/rejects in between: that bumps rev too.
    await rejectGame(g.game_id, henry, "check seats");
    const stored = (await getGame(g.game_id))!;
    expect(stored.rev).toBe(2);

    await expect(
      updateGame(g.game_id, await input({ notes: "late edit", seats: (await input()).seats.slice().reverse() }), g.rev, sam),
    ).rejects.toBeInstanceOf(StaleError);
    expect(await getGame(g.game_id)).toEqual(stored);

    const ok = await updateGame(g.game_id, await input({ notes: "fresh edit" }), stored.rev, sam);
    expect(ok).toMatchObject({ rev: 3, notes: "fresh edit", status: "pending" });
  });

  it("lets only one of two simultaneous edits with the same rev win", async () => {
    const g = await createGame(await input(), henry);
    const results = await Promise.allSettled([
      updateGame(g.game_id, await input({ notes: "A" }), g.rev, sam),
      updateGame(g.game_id, await input({ notes: "B" }), g.rev, alex),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(StaleError);
    const [row] = await db.select().from(games).where(and(eq(games.groupId, gid), eq(games.id, g.game_id)));
    expect(row.rev).toBe(2);
  });
});

describe("decks and players", () => {
  it("allows the same deck name for different owners but not the same owner", async () => {
    await expect(createDeck({ owner_player_id: "sam", name: "tidus" }, sam)).rejects.toThrow(/already has/);
    await expect(createDeck({ owner_player_id: "alex", name: "Other" }, sam)).rejects.toThrow(/own decks/);
    const d = await createDeck(
      { owner_player_id: "sam", name: "Thras", colors: "", commanders: [{ role: "commander", scryfall_oracle_id: "abc", card_name: "Thrasios" }] },
      sam,
    );
    expect(d).toMatchObject({ commander_status: "resolved", colors: "C" });
  });

  it("only admins manage players, and can't demote themselves", async () => {
    await expect(upsertPlayer({ display_name: "New", email: "", role: "player", active: true }, sam)).rejects.toThrow();
    const p = await upsertPlayer({ display_name: "Sam", email: "sam2@x.com", role: "player", active: true }, henry);
    expect(p.player_id).toBe("sam-2");
    await expect(upsertPlayer({ ...henry, role: "player" }, henry)).rejects.toThrow(/own admin/);
    await expect(upsertPlayer({ display_name: "Dup", email: "S@x.com", role: "player", active: true }, henry)).rejects.toThrow(/already uses/);
    // Several players without an email are fine.
    await upsertPlayer({ display_name: "No Mail 1", email: "", role: "player", active: true }, henry);
    await upsertPlayer({ display_name: "No Mail 2", email: "", role: "player", active: true }, henry);
  });
});
