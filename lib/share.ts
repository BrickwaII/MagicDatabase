// Public, read-only stats links. A group can turn on a share link
// (/s/<token>) that anyone can open without signing in. The page only ever
// sees approved games, display names and deck names: no emails, notes,
// pending or rejected games, or audit information.
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { withGroup } from "./db/group";
import { groups } from "./db/schema";
import { AppError, audit, ctx, listDecks, listGames, listPlayers, listRules } from "./data";
import { isAdmin } from "./permissions";
import type { Deck, GameWithSeats, Lookup, Player } from "./schema";
import { GUEST_PLAYER_ID } from "./schema";

/** 18 random bytes → 24 base64url characters. */
export const newShareToken = () => randomBytes(18).toString("base64url");
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** What the audit log records about a token: enough to tell links apart, not enough to use one. */
const tokenHint = (t: string | null | undefined) => (t ? `${t.slice(0, 4)}…` : null);

export interface ShareSettings {
  enabled: boolean;
  token: string | null;
}

function requireShareAdmin(actor: Player) {
  if (!isAdmin(actor)) throw new AppError("Only admins can manage the public stats link");
}

export async function getShareSettings(actor: Player): Promise<ShareSettings> {
  requireShareAdmin(actor);
  const { db, gid } = await ctx();
  const [g] = await db
    .select({ enabled: groups.publicStatsEnabled, token: groups.shareToken })
    .from(groups)
    .where(eq(groups.id, gid));
  if (!g) throw new AppError("Group not found");
  return g;
}

type ShareChange = (cur: ShareSettings) => { next: ShareSettings; action: string } | null;

async function changeShare(actor: Player, change: ShareChange): Promise<ShareSettings> {
  requireShareAdmin(actor);
  const { db, gid } = await ctx();
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ enabled: groups.publicStatsEnabled, token: groups.shareToken })
      .from(groups)
      .where(eq(groups.id, gid))
      .for("update");
    if (!cur) throw new AppError("Group not found");
    const res = change(cur);
    if (!res) return cur;
    await tx
      .update(groups)
      .set({ publicStatsEnabled: res.next.enabled, shareToken: res.next.token })
      .where(eq(groups.id, gid));
    await audit(
      tx,
      gid,
      actor,
      "group",
      gid,
      res.action,
      { public_stats_enabled: cur.enabled, share_token: tokenHint(cur.token) },
      { public_stats_enabled: res.next.enabled, share_token: tokenHint(res.next.token) },
    );
    return res.next;
  });
}

/** Turn the public link on or off. Turning it on creates a token if there is none. */
export function setPublicStats(enabled: boolean, actor: Player) {
  return changeShare(actor, (cur) =>
    cur.enabled === enabled && (!enabled || cur.token)
      ? null
      : { next: { enabled, token: enabled ? (cur.token ?? newShareToken()) : cur.token }, action: enabled ? "share_enable" : "share_disable" },
  );
}

/** Replace the token so the old link stops working. Keeps the on/off setting. */
export function regenerateShareToken(actor: Player) {
  return changeShare(actor, (cur) => ({ next: { enabled: cur.enabled, token: newShareToken() }, action: "share_regenerate" }));
}

/** The group a share token belongs to, if the token exists and sharing is on. Not scoped to the current group. */
export async function findGroupByShareToken(token: string): Promise<{ id: string; name: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const db = await getDb();
  const [g] = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(and(eq(groups.shareToken, token), eq(groups.publicStatsEnabled, true)));
  return g ?? null;
}

export type PublicPlayer = Pick<Player, "player_id" | "display_name">;
export type PublicDeck = Pick<Deck, "deck_id" | "owner_player_id" | "name" | "colors">;

export interface PublicStats {
  group: { name: string };
  /** Approved games only, newest first, with notes and reviewer fields blanked. */
  games: GameWithSeats[];
  /** Players who sat in at least one of those games. */
  players: PublicPlayer[];
  decks: PublicDeck[];
  rules: Lookup[];
}

/** Everything the public page shows for one group, read inside that group. */
export async function loadPublicStats(group: { id: string; name: string }): Promise<PublicStats> {
  return withGroup(group.id, async () => {
    const [games, players, decks, rules] = await Promise.all([
      listGames({ status: "approved" }),
      listPlayers({ includeInactive: true }),
      listDecks({ includeInactive: true }),
      listRules(),
    ]);
    const clean: GameWithSeats[] = games
      .filter((g) => g.status === "approved")
      .map((g) => ({
        game_id: g.game_id,
        day_game_no: g.day_game_no,
        date: g.date,
        status: g.status,
        result: g.result,
        brackets: g.brackets,
        win_conditions: g.win_conditions,
        additional_rules: g.additional_rules,
        notes: "",
        submitted_by: "",
        approved_by: "",
        rev: 0,
        reject_reason: "",
        seats: g.seats.map((s) => ({ ...s })),
      }));
    const seatedPlayers = new Set(clean.flatMap((g) => g.seats.map((s) => s.player_id)));
    const seatedDecks = new Set(clean.flatMap((g) => g.seats.map((s) => s.deck_id)));
    return {
      group: { name: group.name },
      games: clean,
      players: players
        .filter((p) => p.player_id !== GUEST_PLAYER_ID && seatedPlayers.has(p.player_id))
        .map((p) => ({ player_id: p.player_id, display_name: p.display_name })),
      decks: decks
        .filter((d) => seatedDecks.has(d.deck_id))
        .map((d) => ({ deck_id: d.deck_id, owner_player_id: d.owner_player_id, name: d.name, colors: d.colors })),
      rules,
    };
  });
}

/** Token → public data, or null when the link is unknown or sharing is off. */
export async function getPublicStatsByToken(token: string): Promise<PublicStats | null> {
  const group = await findGroupByShareToken(token);
  return group ? loadPublicStats(group) : null;
}
