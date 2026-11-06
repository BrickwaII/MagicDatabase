import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDeck,
  createGame,
  getDeck,
  getGame,
  getPlayer,
  getPlayerByEmail,
  listAudit,
  listDeckCommanders,
  listDecks,
  listGames,
  listPlayers,
  listRules,
  listWinConditions,
  upsertLookup,
  upsertPlayer,
} from "@/lib/data";
import type { Db } from "@/lib/db";
import { currentGroupId, withGroup } from "@/lib/db/group";
import { groups } from "@/lib/db/schema";
import type { Player } from "@/lib/schema";
import { playerStats } from "@/lib/stats";
import { insertPlayers, resetDb, useTestDb } from "./helpers/db";

const admin = (id: string, email: string): Player => ({ player_id: id, display_name: id, email, role: "admin", active: true });
const player = (id: string, email: string): Player => ({ player_id: id, display_name: id, email, role: "player", active: true });

let db: Db;
let home: string;
const other = "other-group";

beforeAll(async () => {
  db = await useTestDb();
});

/** Same player ids in both groups, so only group_id tells the rows apart. */
async function fillGroup(gid: string, emailDomain: string, winnerIndex: number) {
  const ps = [admin("henry", `henry@${emailDomain}`), player("sam", `sam@${emailDomain}`), player("alex", `alex@${emailDomain}`)];
  await insertPlayers(db, gid, ps);
  return withGroup(gid, async () => {
    await upsertLookup("WinConditions", { name: `Combat ${emailDomain}` }, ps[0]);
    await upsertLookup("Rules", { name: `Rule ${emailDomain}` }, ps[0]);
    const deckIds: string[] = [];
    for (const p of ps) deckIds.push((await createDeck({ owner_player_id: p.player_id, name: `Deck ${emailDomain}` }, p)).deck_id);
    const g = await createGame(
      {
        date: "2026-05-01",
        result: "won",
        seats: ps.map((p, i) => ({ player_id: p.player_id, deck_id: deckIds[i], is_winner: i === winnerIndex })),
      },
      ps[0],
    );
    return { gameId: g.game_id, deckIds };
  });
}

beforeEach(async () => {
  home = await resetDb(db, "Home");
  await db.insert(groups).values({ id: other, name: "Other", createdAt: new Date(Date.now() + 60_000) });
});

describe("group scoping", () => {
  it("resolves the oldest group as the current group unless told otherwise", async () => {
    expect(await currentGroupId(db)).toBe(home);
    expect(await withGroup(other, () => currentGroupId(db))).toBe(other);
  });

  it("never returns another group's rows from reads or stats", async () => {
    const mine = await fillGroup(home, "home.test", 0);
    const theirs = await fillGroup(other, "other.test", 1);

    // Same date in both groups, and each group numbers its own games from 1.
    expect((await getGame(mine.gameId))!.day_game_no).toBe(1);
    expect(await withGroup(other, async () => (await getGame(theirs.gameId))!.day_game_no)).toBe(1);

    const homeGames = await listGames();
    expect(homeGames.map((g) => g.game_id)).toEqual([mine.gameId]);
    expect(await getGame(theirs.gameId)).toBeNull();
    expect(await listGames({ playerId: "sam" })).toHaveLength(1);

    expect((await listPlayers()).map((p) => p.email).sort()).toEqual(["alex@home.test", "henry@home.test", "sam@home.test"]);
    expect(await getPlayerByEmail("sam@other.test")).toBeNull();
    expect((await getPlayer("sam"))!.email).toBe("sam@home.test");

    expect((await listDecks()).every((d) => d.name === "Deck home.test")).toBe(true);
    expect(await getDeck(theirs.deckIds[0])).toBeNull();
    expect((await listDeckCommanders()).every((c) => mine.deckIds.includes(c.deck_id))).toBe(true);
    expect((await listWinConditions()).map((w) => w.name)).toEqual(["Combat home.test"]);
    expect((await listRules()).map((r) => r.name)).toEqual(["Rule home.test"]);
    expect((await listAudit()).some((a) => a.entity_id === theirs.gameId)).toBe(false);

    // Stats over the home group: henry won the only home game; sam won only in the other group.
    const stats = playerStats(homeGames);
    expect(stats.find((s) => s.player_id === "henry")).toMatchObject({ games: 1, wins: 1 });
    expect(stats.find((s) => s.player_id === "sam")).toMatchObject({ games: 1, wins: 0 });

    // And the other group sees only its own.
    await withGroup(other, async () => {
      const g = await listGames();
      expect(g.map((x) => x.game_id)).toEqual([theirs.gameId]);
      expect(playerStats(g).find((s) => s.player_id === "sam")).toMatchObject({ games: 1, wins: 1 });
      expect(await getPlayerByEmail("sam@home.test")).toBeNull();
    });
  });

  it("refuses decks and seats that point at another group's players or decks", async () => {
    const theirs = await fillGroup(other, "other.test", 0);
    await insertPlayers(db, home, [admin("henry", "henry@home.test"), player("sam", "s@home.test"), player("kim", "k@home.test")]);
    const henry = admin("henry", "henry@home.test");
    await expect(createDeck({ owner_player_id: "alex", name: "X" }, henry)).rejects.toThrow(/Unknown owner/);
    await expect(
      createGame(
        {
          date: "2026-05-02",
          result: "won",
          seats: [
            { player_id: "henry", deck_id: theirs.deckIds[0], is_winner: true },
            { player_id: "sam", deck_id: theirs.deckIds[1] },
            { player_id: "RANDOM" },
          ],
        },
        henry,
      ),
    ).rejects.toThrow(/unknown deck/);
  });

  it("allows the same email in two groups but not twice in one", async () => {
    await insertPlayers(db, home, [admin("henry", "henry@x.test")]);
    await insertPlayers(db, other, [admin("henry", "henry@x.test")]);
    const henry = admin("henry", "henry@x.test");
    await expect(upsertPlayer({ display_name: "Copy", email: "henry@x.test", role: "player", active: true }, henry)).rejects.toThrow(
      /already uses/,
    );
    await expect(insertPlayers(db, home, [player("copy", "henry@x.test")])).rejects.toThrow();
  });
});
