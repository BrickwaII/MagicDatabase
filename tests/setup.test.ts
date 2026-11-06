import { count, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGame, listGames } from "@/lib/data";
import { migrateDb, type Db } from "@/lib/db";
import { DEFAULT_GROUP_NAME, forgetDefaultGroup } from "@/lib/db/group";
import { importMigration, AppGamesExistError } from "@/lib/db/import";
import { groups, players } from "@/lib/db/schema";
import { runSetup } from "@/lib/db/setup";
import { parseCsv } from "@/lib/csv";
import { migrate } from "@/lib/migrate";
import { useTestDb } from "./helpers/db";

let db: Db;

beforeAll(async () => {
  db = await useTestDb();
});

beforeEach(async () => {
  await db.execute(sql`truncate table groups, audit_log cascade`);
  forgetDefaultGroup(db);
});

describe("migrations", () => {
  it("can be applied again without changing anything", async () => {
    await migrateDb(db, "pglite");
    await migrateDb(db, "pglite");
    const res = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const rows = (res as unknown as { rows: { n: number }[] }).rows;
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe("setup", () => {
  it("creates one default group and one admin, however often it runs", async () => {
    const first = await runSetup(db, { admin: { email: "Henry@Gmail.com", name: "Henry" } });
    expect(first).toMatchObject({ created: true, group: { name: DEFAULT_GROUP_NAME, publicStatsEnabled: false, shareToken: null } });
    expect(first.admin).toMatchObject({ id: "henry", action: "created", email: "henry@gmail.com" });

    const again = await runSetup(db, { admin: { email: "henry@gmail.com", name: "Henry" } });
    expect(again).toMatchObject({ created: false, group: { id: first.group.id } });
    expect(again.admin?.action).toBe("unchanged");

    expect((await db.select({ n: count() }).from(groups))[0].n).toBe(1);
    const ps = await db.select().from(players);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ groupId: first.group.id, role: "admin", active: true });
  });

  it("names the group with --group and promotes an existing player", async () => {
    const a = await runSetup(db, { groupName: "Thursday Pod" });
    expect(a.group.name).toBe("Thursday Pod");
    await db.insert(players).values({ groupId: a.group.id, id: "henry", displayName: "Henry", role: "player", active: false });
    const b = await runSetup(db, { admin: { email: "h@x.test", name: "Henry" } });
    expect(b.admin?.action).toBe("promoted");
    const [p] = await db.select().from(players).where(eq(players.id, "henry"));
    expect(p).toMatchObject({ email: "h@x.test", role: "admin", active: true });
    const c = await runSetup(db, { groupName: "Renamed" });
    expect(c.group).toMatchObject({ id: a.group.id, name: "Renamed" });
  });
});

describe("importing the old sheet", () => {
  const old = {
    decks: parseCsv(`Henry,Sam,Alex\n🟥🟩⬜Tifa,⬜🟦Tidus,🟦🟩Kilo\n`),
    games: parseCsv(`Date,Game #,Seat Order,Player,Deck,Winner,Win Condition,Additional Rules
1/3/2026,1,1,Henry,🟥🟩⬜Tifa,TRUE,Combat,Planeschase
,,2,Sam,⬜🟦Tidus,FALSE,,
,,3,Alex,🟦🟩Kilo,FALSE,,
,,4,RANDOM,,FALSE,,
`),
  };

  it("is rerunnable with stable ids and keeps app games only with --force", async () => {
    const { group } = await runSetup(db, { admin: { email: "henry@x.test", name: "Henry" } });
    const res = migrate(old);
    await importMigration(db, group.id, res);
    await importMigration(db, group.id, migrate(old));
    const games = await listGames();
    expect(games.map((g) => g.game_id)).toEqual(["m_2026-01-03_01"]);
    expect(games[0]).toMatchObject({ additional_rules: ["planechase"], win_conditions: ["combat"] });
    expect(games[0].seats[3]).toMatchObject({ player_id: "RANDOM", deck_id: "" });
    // The admin's email and role survive the import.
    const [henry] = await db.select().from(players).where(eq(players.id, "henry"));
    expect(henry).toMatchObject({ email: "henry@x.test", role: "admin" });

    const henryP = { player_id: "henry", display_name: "Henry", email: "henry@x.test", role: "admin" as const, active: true };
    const appGame = await createGame(
      {
        date: "2026-01-03",
        result: "won",
        seats: games[0].seats.map((s) => ({ player_id: s.player_id, deck_id: s.deck_id, is_winner: s.seat === 2 })),
      },
      henryP,
    );
    expect(appGame.day_game_no).toBe(2);
    await expect(importMigration(db, group.id, migrate(old))).rejects.toBeInstanceOf(AppGamesExistError);
    await importMigration(db, group.id, migrate(old), { force: true });
    expect((await listGames()).map((g) => g.game_id).sort()).toEqual([appGame.game_id, "m_2026-01-03_01"].sort());
  });
});
