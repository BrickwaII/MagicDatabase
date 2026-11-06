// In-memory PGlite for tests: one database per test file, wiped between tests.
import { sql } from "drizzle-orm";
import { afterAll } from "vitest";
import { closeDb, openPglite, setDb, type Db } from "@/lib/db";
import { ensureDefaultGroup, forgetDefaultGroup } from "@/lib/db/group";
import { players } from "@/lib/db/schema";
import type { Player } from "@/lib/schema";

export async function useTestDb(): Promise<Db> {
  const h = await openPglite(undefined);
  await h.ready;
  setDb(h.db);
  afterAll(async () => {
    await closeDb();
    await h.close();
  });
  return h.db;
}

/** Remove every row (groups cascade to everything else) and start a fresh default group. */
export async function resetDb(db: Db, groupName = "Test group") {
  await db.execute(sql`truncate table groups, audit_log cascade`);
  forgetDefaultGroup(db);
  const { group } = await ensureDefaultGroup(db, groupName);
  return group.id;
}

export async function insertPlayers(db: Db, groupId: string, list: Player[]) {
  await db.insert(players).values(
    list.map((p) => ({
      groupId,
      id: p.player_id,
      displayName: p.display_name,
      email: p.email || null,
      role: p.role,
      active: p.active,
    })),
  );
}
