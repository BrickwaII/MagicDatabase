// Which group the current request works in. The app is single-group for now:
// unless code runs inside `withGroup(id, ...)`, the current group is the
// default (oldest) group. All queries filter on this id, so adding real
// multi-group support later only means choosing the id per request.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { Db } from "./index";
import { groups } from "./schema";

export const DEFAULT_GROUP_NAME = "Henry's Playgroup";

const scoped = new AsyncLocalStorage<string>();
const defaults = new WeakMap<Db, string>();

export class NoGroupError extends Error {
  constructor() {
    super("No group exists yet. Run `npm run setup -- --admin you@gmail.com \"Your name\"` (or `npm run seed` locally).");
  }
}

/** Run `fn` with a specific group as the current group. */
export function withGroup<T>(groupId: string, fn: () => T): T {
  return scoped.run(groupId, fn);
}

export async function defaultGroupId(db: Db): Promise<string | null> {
  const hit = defaults.get(db);
  if (hit) return hit;
  const [row] = await db.select({ id: groups.id }).from(groups).orderBy(asc(groups.createdAt), asc(groups.id)).limit(1);
  if (row) defaults.set(db, row.id);
  return row?.id ?? null;
}

/** Drop the cached default group id (tests that wipe the database). */
export function forgetDefaultGroup(db: Db) {
  defaults.delete(db);
}

export async function currentGroupId(db: Db): Promise<string> {
  const id = scoped.getStore() ?? (await defaultGroupId(db));
  if (!id) throw new NoGroupError();
  return id;
}

/** Return the default group, creating it if there is none. */
export async function ensureDefaultGroup(db: Db, name?: string) {
  const existing = await defaultGroupId(db);
  if (existing) {
    if (name) await db.update(groups).set({ name }).where(eq(groups.id, existing));
    const [g] = await db.select().from(groups).where(eq(groups.id, existing));
    return { group: g, created: false };
  }
  const [g] = await db
    .insert(groups)
    .values({ id: randomUUID(), name: name || DEFAULT_GROUP_NAME })
    .returning();
  defaults.set(db, g.id);
  return { group: g, created: true };
}
