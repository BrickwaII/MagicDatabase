// One-time (and safely repeatable) setup: default group plus first admin.
import { and, eq, or } from "drizzle-orm";
import { GUEST_PLAYER_ID } from "../schema";
import { slugify } from "../util";
import { ensureDefaultGroup } from "./group";
import type { Db } from "./index";
import { auditLog, players } from "./schema";

export interface SetupOptions {
  /** Rename the default group (or name it on creation). */
  groupName?: string;
  admin?: { email: string; name?: string };
}

export async function runSetup(db: Db, opts: SetupOptions = {}) {
  const { group, created } = await ensureDefaultGroup(db, opts.groupName);
  let admin: { id: string; name: string; email: string; action: "created" | "promoted" | "unchanged" } | undefined;

  if (opts.admin) {
    const email = opts.admin.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Usage: --admin you@gmail.com "Display name"');
    const name = (opts.admin.name ?? "").trim() || email.split("@")[0];
    let id = slugify(name);
    if (id === GUEST_PLAYER_ID.toLowerCase()) id = `${id}-2`;

    admin = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(players)
        .where(and(eq(players.groupId, group.id), or(eq(players.email, email), eq(players.id, id))))
        .orderBy(players.id)
        .limit(1);
      if (existing) {
        const unchanged = existing.email === email && existing.role === "admin" && existing.active;
        if (!unchanged) {
          await tx
            .update(players)
            .set({ email, role: "admin", active: true })
            .where(and(eq(players.groupId, group.id), eq(players.id, existing.id)));
          await tx.insert(auditLog).values({
            groupId: group.id,
            actor: "setup",
            entity: "player",
            entityId: existing.id,
            action: "update",
            before: existing,
            after: { ...existing, email, role: "admin", active: true },
          });
        }
        return { id: existing.id, name: existing.displayName, email, action: unchanged ? "unchanged" : "promoted" } as const;
      }
      const row = { groupId: group.id, id, displayName: name, email, role: "admin" as const, active: true };
      await tx.insert(players).values(row);
      await tx.insert(auditLog).values({
        groupId: group.id,
        actor: "setup",
        entity: "player",
        entityId: id,
        action: "create",
        after: row,
      });
      return { id, name, email, action: "created" } as const;
    });
  }
  return { group, created, admin };
}
