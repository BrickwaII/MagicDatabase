import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDeck, createGame, listAudit, rejectGame, type GameInput } from "@/lib/data";
import type { Db } from "@/lib/db";
import { withGroup } from "@/lib/db/group";
import { groups } from "@/lib/db/schema";
import { parseCsv } from "@/lib/csv";
import { CSV_EXPORTS, exportCsv, exportGroupJson } from "@/lib/export";
import type { Player } from "@/lib/schema";
import {
  findGroupByShareToken,
  getPublicStatsByToken,
  getShareSettings,
  regenerateShareToken,
  setPublicStats,
} from "@/lib/share";
import { playerStats } from "@/lib/stats";
import { insertPlayers, resetDb, useTestDb } from "./helpers/db";

const henry: Player = { player_id: "henry", display_name: "Henry", email: "henry@example.com", role: "admin", active: true };
const sam: Player = { player_id: "sam", display_name: "Sam", email: "sam@example.com", role: "player", active: true };
const alex: Player = { player_id: "alex", display_name: "Alex", email: "alex@example.com", role: "player", active: true };
const kim: Player = { player_id: "kim", display_name: "Kim", email: "kim@example.com", role: "player", active: true };

let db: Db;
let home: string;
const other = "other-group";
const decks: Record<string, string> = {};

beforeAll(async () => {
  db = await useTestDb();
});

const game = (winner: string, over: Partial<GameInput> = {}): GameInput => ({
  date: "2026-04-01",
  result: "won",
  seats: ["henry", "sam", "alex"].map((p) => ({ player_id: p, deck_id: decks[p], is_winner: p === winner })),
  ...over,
});

beforeEach(async () => {
  home = await resetDb(db, "Home");
  await db.insert(groups).values({ id: other, name: "Other", createdAt: new Date(Date.now() + 60_000) });
  await insertPlayers(db, home, [henry, sam, alex, kim]);
  for (const p of [henry, sam, alex]) {
    decks[p.player_id] = (await createDeck({ owner_player_id: p.player_id, name: `${p.display_name} deck`, notes: "secret deck note" }, p)).deck_id;
  }
});

describe("share settings", () => {
  it("creates a token when turned on, and turning off disables the link", async () => {
    expect(await getShareSettings(henry)).toEqual({ enabled: false, token: null });
    const on = await setPublicStats(true, henry);
    expect(on.enabled).toBe(true);
    expect(on.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await findGroupByShareToken(on.token!)).toEqual({ id: home, name: "Home" });

    const off = await setPublicStats(false, henry);
    expect(off).toEqual({ enabled: false, token: on.token });
    expect(await findGroupByShareToken(on.token!)).toBeNull();
    expect(await getPublicStatsByToken(on.token!)).toBeNull();

    // Turning it back on keeps the same link.
    expect((await setPublicStats(true, henry)).token).toBe(on.token);
    const actions = (await listAudit()).filter((a) => a.entity === "group").map((a) => a.action);
    expect(actions).toEqual(["share_enable", "share_disable", "share_enable"]);
    // The audit log never holds a usable token.
    expect(JSON.stringify(await listAudit())).not.toContain(on.token!);
  });

  it("regenerate invalidates the old token", async () => {
    const first = (await setPublicStats(true, henry)).token!;
    const second = (await regenerateShareToken(henry)).token!;
    expect(second).not.toBe(first);
    expect(await findGroupByShareToken(first)).toBeNull();
    expect(await getPublicStatsByToken(first)).toBeNull();
    expect(await findGroupByShareToken(second)).toMatchObject({ id: home });
    expect((await listAudit()).some((a) => a.action === "share_regenerate")).toBe(true);
  });

  it("rejects unknown and malformed tokens", async () => {
    await setPublicStats(true, henry);
    expect(await findGroupByShareToken("A".repeat(24))).toBeNull();
    expect(await findGroupByShareToken("")).toBeNull();
    expect(await findGroupByShareToken("' or 1=1 --")).toBeNull();
  });

  it("refuses non-admins", async () => {
    await expect(getShareSettings(sam)).rejects.toThrow(/Only admins/);
    await expect(setPublicStats(true, sam)).rejects.toThrow(/Only admins/);
    await expect(regenerateShareToken(sam)).rejects.toThrow(/Only admins/);
    const inactiveAdmin = { ...henry, active: false };
    await expect(setPublicStats(true, inactiveAdmin)).rejects.toThrow(/Only admins/);
    expect(await getShareSettings(henry)).toEqual({ enabled: false, token: null });
    expect((await listAudit()).some((a) => a.entity === "group")).toBe(false);
  });
});

describe("public stats", () => {
  it("is scoped to the token's group and only shows approved games without emails or notes", async () => {
    const approved = await createGame(game("henry", { notes: "private approved note" }), henry);
    await createGame(game("sam", { notes: "pending note" }), sam);
    const rejected = await createGame(game("alex", { notes: "rejected note" }), sam);
    await rejectGame(rejected.game_id, henry, "wrong pod");

    // Another group with its own sharing on and a game Sam won.
    await insertPlayers(db, other, [
      { ...henry, email: "henry@other.test" },
      { ...sam, email: "sam@other.test", display_name: "Other Sam" },
      { ...alex, email: "alex@other.test" },
    ]);
    const otherToken = await withGroup(other, async () => {
      const ids: Record<string, string> = {};
      for (const p of ["henry", "sam", "alex"]) ids[p] = (await createDeck({ owner_player_id: p, name: "Other deck" }, henry)).deck_id;
      await createGame(
        { date: "2026-04-01", result: "won", seats: ["henry", "sam", "alex"].map((p) => ({ player_id: p, deck_id: ids[p], is_winner: p === "sam" })) },
        henry,
      );
      return (await setPublicStats(true, henry)).token!;
    });

    const token = (await setPublicStats(true, henry)).token!;
    const data = (await getPublicStatsByToken(token))!;
    expect(data.group.name).toBe("Home");
    expect(data.games.map((g) => g.game_id)).toEqual([approved.game_id]);
    expect(data.games.every((g) => g.status === "approved" && g.notes === "" && g.reject_reason === "")).toBe(true);
    expect(data.players.map((p) => p.display_name).sort()).toEqual(["Alex", "Henry", "Sam"]); // Kim never played
    expect(playerStats(data.games).find((s) => s.player_id === "henry")).toMatchObject({ games: 1, wins: 1 });

    const json = JSON.stringify(data);
    expect(json).not.toContain("@");
    expect(json).not.toMatch(/secret deck note|private approved note|pending note|rejected note|wrong pod|Other Sam/);
    expect(json).not.toContain('"role"');

    const theirs = (await getPublicStatsByToken(otherToken))!;
    expect(theirs.group.name).toBe("Other");
    expect(theirs.players.map((p) => p.display_name)).toContain("Other Sam");
    expect(playerStats(theirs.games).find((s) => s.player_id === "sam")).toMatchObject({ games: 1, wins: 1 });
    expect(theirs.games.some((g) => g.game_id === approved.game_id)).toBe(false);
  });

  it("returns nothing for a group whose sharing is off", async () => {
    await createGame(game("henry"), henry);
    const token = (await setPublicStats(true, henry)).token!;
    await setPublicStats(false, henry);
    expect(await getPublicStatsByToken(token)).toBeNull();
  });
});

describe("export", () => {
  it("refuses non-admins", async () => {
    await expect(exportGroupJson(sam)).rejects.toThrow(/Only admins/);
    for (const e of CSV_EXPORTS) await expect(exportCsv(e, sam)).rejects.toThrow(/Only admins/);
  });

  it("exports the whole group for admins, emails and notes included", async () => {
    await createGame(game("henry", { notes: "keep me" }), henry);
    await createGame(game("sam"), sam);
    await setPublicStats(true, henry);
    const out = await exportGroupJson(henry);
    expect(out.group.name).toBe("Home");
    expect(out.players.map((p) => p.email)).toContain("kim@example.com");
    expect(out.games).toHaveLength(2);
    expect(out.games.some((g) => g.notes === "keep me")).toBe(true);
    expect(out.decks[0].notes).toBe("secret deck note");
    expect(out.audit_log.length).toBeGreaterThan(0);
    expect(JSON.stringify(out)).not.toContain((await db.select().from(groups).where(eq(groups.id, home)))[0].shareToken!);
  });

  it("writes a games CSV with one row per seat", async () => {
    await createGame(game("sam", { notes: 'tricky, "quoted"\nnote', brackets: ["3"] }), henry);
    const rows = parseCsv((await exportCsv("games-flat", henry)).trimEnd());
    expect(rows[0].slice(0, 12)).toEqual([
      "Date", "Game #", "Seat", "Player", "Deck", "Winner", "Result", "Status", "Brackets", "Win conditions", "Rules", "Notes",
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[2].slice(0, 9)).toEqual(["2026-04-01", "1", "2", "Sam", "Sam deck", "Yes", "Won", "approved", "3"]);
    expect(rows[1][11]).toBe('tricky, "quoted"\nnote');

    const players = parseCsv((await exportCsv("players", henry)).trimEnd());
    expect(players).toContainEqual(["kim", "Kim", "kim@example.com", "player", "Yes"]);
    const deckRows = parseCsv((await exportCsv("decks", henry)).trimEnd());
    expect(deckRows[0][0]).toBe("Deck ID");
    expect(deckRows).toHaveLength(4);
  });
});
