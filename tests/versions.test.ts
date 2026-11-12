import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { createDeck, createGame, getDeck, type GameInput } from "@/lib/data";
import type { Db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { exportCsv, exportGroupJson } from "@/lib/export";
import type { GameWithSeats, Player, VersionRef } from "@/lib/schema";
import { getPublicStatsByToken, setPublicStats } from "@/lib/share";
import { deckStats, deckVersionStats, versionOn } from "@/lib/stats";
import { createDeckVersion, deleteDeckVersion, listDeckVersions, updateDeckVersion } from "@/lib/versions";
import { insertPlayers, resetDb, useTestDb } from "./helpers/db";

const v = (version_no: number, started_on: string, deck_id = "d1"): VersionRef => ({ deck_id, version_no, started_on });

describe("version resolution by date", () => {
  const versions = [v(2, "2026-05-10"), v(3, "2026-06-01")];
  it("uses v1 before the first change, the new version from the change's day on", () => {
    expect(versionOn([], "2026-01-01")).toBe(1);
    expect(versionOn(versions, "2026-05-09")).toBe(1);
    expect(versionOn(versions, "2026-05-10")).toBe(2); // same day → the new version
    expect(versionOn(versions, "2026-05-31")).toBe(2);
    expect(versionOn(versions, "2026-06-01")).toBe(3);
    expect(versionOn(versions, "2027-01-01")).toBe(3);
  });
});

let n = 0;
function game(date: string, seats: [string, string, boolean][], over: Partial<GameWithSeats> = {}): GameWithSeats {
  const id = `g${n++}`;
  return {
    game_id: id,
    day_game_no: 1,
    date,
    status: "approved",
    result: "won",
    brackets: [],
    win_conditions: [],
    additional_rules: [],
    notes: "",
    submitted_by: "a",
    approved_by: "a",
    rev: 1,
    reject_reason: "",
    seats: seats.map(([player_id, deck_id, is_winner], i) => ({
      game_id: id,
      seat: i + 1,
      player_id,
      deck_id,
      is_winner,
      guest_name: "",
      guest_deck: "",
      guest_added_by: "",
    })),
    ...over,
  };
}

describe("per-version stats", () => {
  const games = [
    game("2026-05-01", [["a", "d1", false], ["b", "db", true], ["c", "dc", false]]),
    game("2026-05-02", [["a", "d1", false], ["b", "db", true], ["c", "dc", false], ["e", "de", false]]),
    game("2026-05-10", [["a", "d1", true], ["b", "db", false], ["c", "dc", false]]),
    game("2026-05-11", [["b", "d1", true], ["a", "da", false], ["c", "dc", false], ["e", "de", false]]), // borrowed
    game("2026-05-12", [["a", "d1", true], ["b", "db", false], ["c", "dc", false]], { status: "pending" }),
    game("2026-05-13", [["a", "d1", false], ["b", "db", false], ["c", "dc", false]], { result: "draw" }),
  ];
  const versions = [v(2, "2026-05-10"), v(2, "2026-05-10", "db")];

  it("splits a deck's counted games by version, all pilots, with expected rates", () => {
    const [v1, v2] = deckVersionStats(games, "d1", versions);
    expect(v1).toMatchObject({ version_no: 1, started_on: "", until: "2026-05-09", games: 2, wins: 0, winRate: 0 });
    expect(v1.expected).toBeCloseTo((1 / 3 + 1 / 4) / 2);
    expect(v2).toMatchObject({ version_no: 2, started_on: "2026-05-10", until: "", games: 2, wins: 2, winRate: 1 });
    expect(v2.firstPlayed).toBe("2026-05-10");
    expect(deckVersionStats(games, "dx", [])).toMatchObject([{ version_no: 1, games: 0, expected: 0 }]);
  });

  it("splits the Decks table by version only when asked", () => {
    expect(deckStats(games, {}).find((s) => s.deck_id === "d1" && s.player_id === "a")).toMatchObject({ games: 3, wins: 1 });
    const split = deckStats(games, {}, versions).filter((s) => s.deck_id === "d1" && s.player_id === "a");
    expect(split.map((s) => [s.version_no, s.games, s.wins])).toEqual([
      [1, 2, 0],
      [2, 1, 1],
    ]);
    expect(deckStats(games, {}, versions).find((s) => s.deck_id === "dc")!.version_no).toBe(1);
  });
});

const henry: Player = { player_id: "henry", display_name: "Henry", email: "h@x.com", role: "admin", active: true };
const sam: Player = { player_id: "sam", display_name: "Sam", email: "s@x.com", role: "player", active: true };
const alex: Player = { player_id: "alex", display_name: "Alex", email: "a@x.com", role: "player", active: true };

let db: Db;
let gid: string;
const decks: Record<string, string> = {};

beforeAll(async () => {
  db = await useTestDb();
});

beforeEach(async () => {
  gid = await resetDb(db);
  await insertPlayers(db, gid, [henry, sam, alex]);
  for (const p of [henry, sam, alex]) decks[p.player_id] = (await createDeck({ owner_player_id: p.player_id, name: `${p.display_name} deck` }, p)).deck_id;
});

const gameOn = (date: string, winner: string): GameInput => ({
  date,
  result: "won",
  seats: ["henry", "sam", "alex"].map((p) => ({ player_id: p, deck_id: decks[p], is_winner: p === winner })),
});

describe("logging deck changes", () => {
  it("lets the owner or an admin log, edit and delete changes, numbered by date, with an audit trail", async () => {
    const later = await createDeckVersion(decks.sam, { started_on: "2026-06-01", note: "Added Rhystic Study" }, sam);
    expect(later.version_no).toBe(2);
    // Logged afterwards but dated earlier: becomes v2 and the other moves to v3.
    const earlier = await createDeckVersion(decks.sam, { started_on: "2026-05-01", note: "Cut 6 removal" }, henry);
    expect(earlier.version_no).toBe(2);
    expect((await listDeckVersions(decks.sam)).map((x) => [x.version_no, x.note])).toEqual([
      [2, "Cut 6 removal"],
      [3, "Added Rhystic Study"],
    ]);
    await expect(createDeckVersion(decks.sam, { started_on: "2026-05-01", note: "Again" }, sam)).rejects.toThrow(/already logged/);
    await expect(createDeckVersion(decks.sam, { started_on: "2026-05-02", note: "" }, sam)).rejects.toThrow(/what changed/);
    await expect(createDeckVersion(decks.sam, { started_on: "2026-05-02", note: "x".repeat(501) }, sam)).rejects.toThrow(/500/);
    await expect(createDeckVersion(decks.sam, { started_on: "2026-02-30", note: "x" }, sam)).rejects.toThrow(/date/);

    const moved = await updateDeckVersion(decks.sam, earlier.id, { started_on: "2026-07-01", note: "Cut 6 removal" }, sam);
    expect(moved.version_no).toBe(3);
    await deleteDeckVersion(decks.sam, later.id, sam);
    expect((await listDeckVersions(decks.sam)).map((x) => [x.version_no, x.started_on])).toEqual([[2, "2026-07-01"]]);

    const actions = (await db.select().from(auditLog).where(and(eq(auditLog.groupId, gid), eq(auditLog.entity, "deck_version")))).map(
      (r) => r.action,
    );
    expect(actions).toEqual(["create", "create", "update", "delete"]);
  });

  it("refuses a player logging a change on someone else's deck", async () => {
    await expect(createDeckVersion(decks.sam, { started_on: "2026-05-01", note: "Mine now" }, alex)).rejects.toThrow(/your own decks/);
    const ok = await createDeckVersion(decks.sam, { started_on: "2026-05-01", note: "Sam's" }, sam);
    await expect(updateDeckVersion(decks.sam, ok.id, { started_on: "2026-05-01", note: "x" }, alex)).rejects.toThrow(/your own decks/);
    await expect(deleteDeckVersion(decks.sam, ok.id, alex)).rejects.toThrow(/your own decks/);
    expect(await listDeckVersions(decks.sam)).toHaveLength(1);
  });

  it("makes a new version's list link the deck's current link", async () => {
    await createDeckVersion(decks.sam, { started_on: "2026-05-01", note: "New list", list_url: "https://archidekt.com/decks/2" }, sam);
    expect((await getDeck(decks.sam))!.list_url).toBe("https://archidekt.com/decks/2");
    // An older change's link doesn't replace the current one.
    await createDeckVersion(decks.sam, { started_on: "2026-04-01", note: "Old", list_url: "https://archidekt.com/decks/1" }, sam);
    expect((await getDeck(decks.sam))!.list_url).toBe("https://archidekt.com/decks/2");
    await expect(createDeckVersion(decks.sam, { started_on: "2026-06-01", note: "x", list_url: "javascript:alert(1)" }, sam)).rejects.toThrow(
      /Deck list link/,
    );
  });

  it("exports versions, and the public page gets only version numbers and dates", async () => {
    await createGame(gameOn("2026-04-30", "sam"), henry);
    await createGame(gameOn("2026-05-01", "henry"), henry);
    await createDeckVersion(decks.sam, { started_on: "2026-05-01", note: "Secret tech", list_url: "https://lists.example.test/secret" }, sam);
    const token = (await setPublicStats(true, henry)).token!;
    const data = (await getPublicStatsByToken(token))!;
    expect(data.versions).toEqual([{ deck_id: decks.sam, version_no: 2, started_on: "2026-05-01" }]);
    expect(JSON.stringify(data)).not.toMatch(/Secret tech|lists\.example\.test/);
    const split = deckStats(data.games, {}, data.versions).filter((s) => s.deck_id === decks.sam);
    expect(split.map((s) => [s.version_no, s.games, s.wins])).toEqual([
      [1, 1, 1],
      [2, 1, 0],
    ]);

    const json = await exportGroupJson(henry);
    expect(json.deck_versions).toMatchObject([{ deck_id: decks.sam, version_no: 2, note: "Secret tech" }]);
    const deckRows = parseCsv((await exportCsv("decks", henry)).trimEnd());
    expect(deckRows[0].at(-1)).toBe("Current version");
    expect(deckRows.find((r) => r[0] === decks.sam)!.at(-1)).toBe("2");
    expect(deckRows.find((r) => r[0] === decks.alex)!.at(-1)).toBe("1");
    const versionRows = parseCsv((await exportCsv("deck-versions", henry)).trimEnd());
    expect(versionRows[1].slice(0, 7)).toEqual([decks.sam, "Sam", "Sam deck", "2", "2026-05-01", "Secret tech", "https://lists.example.test/secret"]);
  });
});
