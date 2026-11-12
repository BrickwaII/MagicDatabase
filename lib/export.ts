// Admin backups: the whole group as one JSON file, and CSV files per entity.
// Admins get everything, emails and notes included.
import { asc, eq } from "drizzle-orm";
import { groups, auditLog } from "./db/schema";
import { toCsv } from "./csv";
import {
  AppError,
  audit,
  ctx,
  listDeckCommanders,
  listDecks,
  listGames,
  listPlayers,
  listRules,
  listWinConditions,
} from "./data";
import { isAdmin } from "./permissions";
import { listDeckVersions } from "./versions";
import { GUEST_PLAYER_ID, type GameWithSeats, type Player } from "./schema";

export const CSV_EXPORTS = ["games-flat", "players", "decks", "deck-versions"] as const;
export type CsvExport = (typeof CSV_EXPORTS)[number];

function requireExportAdmin(actor: Player) {
  if (!isAdmin(actor)) throw new AppError("Only admins can export data");
}

async function load() {
  const [players, decks, commanders, winConditions, rules, games, versions] = await Promise.all([
    listPlayers({ includeInactive: true }),
    listDecks({ includeInactive: true }),
    listDeckCommanders(),
    listWinConditions(),
    listRules(),
    listGames(),
    listDeckVersions(),
  ]);
  return { players, decks, commanders, winConditions, rules, games, versions };
}

/** The whole group as plain JSON (everything except the share token itself). */
export async function exportGroupJson(actor: Player) {
  requireExportAdmin(actor);
  const { db, gid } = await ctx();
  const [[group], data, auditRows] = await Promise.all([
    db.select().from(groups).where(eq(groups.id, gid)),
    load(),
    db.select().from(auditLog).where(eq(auditLog.groupId, gid)).orderBy(asc(auditLog.id)),
  ]);
  const byDeck = new Map<string, typeof data.commanders>();
  for (const c of data.commanders) byDeck.set(c.deck_id, [...(byDeck.get(c.deck_id) ?? []), c]);
  const out = {
    format: "commander-tracker-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    exported_by: actor.player_id,
    group: {
      id: group.id,
      name: group.name,
      created_at: group.createdAt.toISOString(),
      public_stats_enabled: group.publicStatsEnabled,
    },
    players: data.players,
    decks: data.decks.map((d) => ({ ...d, commanders: byDeck.get(d.deck_id) ?? [] })),
    deck_versions: data.versions,
    win_conditions: data.winConditions,
    rules: data.rules,
    games: [...data.games].reverse(),
    audit_log: auditRows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actor: r.actor,
      entity: r.entity,
      entity_id: r.entityId,
      action: r.action,
      before: r.before,
      after: r.after,
    })),
  };
  await audit(db, gid, actor, "export", "json", "export", undefined, { games: out.games.length });
  return out;
}

const RESULT_LABEL: Record<GameWithSeats["result"], string> = { won: "Won", draw: "Draw", unfinished: "Unfinished" };

/** One CSV file. games-flat has one row per seat, laid out like the old sheet. */
export async function exportCsv(entity: CsvExport, actor: Player): Promise<string> {
  requireExportAdmin(actor);
  const { db, gid } = await ctx();
  const data = await load();
  const playerName = (id: string) =>
    id === GUEST_PLAYER_ID ? "Guest" : (data.players.find((p) => p.player_id === id)?.display_name ?? id);
  const deckById = new Map(data.decks.map((d) => [d.deck_id, d]));
  const wcName = new Map(data.winConditions.map((w) => [w.id, w.name]));
  const ruleName = new Map(data.rules.map((r) => [r.id, r.name]));
  let rows: (string | number | boolean)[][];

  if (entity === "games-flat") {
    rows = [
      [
        "Date",
        "Game #",
        "Seat",
        "Player",
        "Deck",
        "Winner",
        "Result",
        "Status",
        "Brackets",
        "Win conditions",
        "Rules",
        "Notes",
        "Game ID",
        "Guest name",
        "Guest deck",
        "Guest added by",
      ],
    ];
    const games = [...data.games].sort((a, b) => a.date.localeCompare(b.date) || a.day_game_no - b.day_game_no);
    for (const g of games) {
      for (const s of g.seats) {
        const deck = s.deck_id ? deckById.get(s.deck_id) : undefined;
        const borrowed = deck && deck.owner_player_id !== s.player_id ? ` (${playerName(deck.owner_player_id)}'s)` : "";
        rows.push([
          g.date,
          g.day_game_no,
          s.seat,
          playerName(s.player_id),
          deck ? `${deck.name}${borrowed}` : s.player_id === GUEST_PLAYER_ID ? "RANDOM" : s.deck_id,
          s.is_winner ? "Yes" : "",
          RESULT_LABEL[g.result],
          g.status,
          g.brackets.join(", "),
          g.win_conditions.map((w) => wcName.get(w) ?? w).join(", "),
          g.additional_rules.map((r) => ruleName.get(r) ?? r).join(", "),
          g.notes,
          g.game_id,
          s.guest_name,
          s.guest_deck,
          s.guest_added_by ? playerName(s.guest_added_by) : "",
        ]);
      }
    }
  } else if (entity === "deck-versions") {
    rows = [["Deck ID", "Owner", "Deck", "Version", "Started on", "Note", "List URL", "Logged by", "Logged at"]];
    for (const v of data.versions) {
      const d = deckById.get(v.deck_id);
      rows.push([
        v.deck_id,
        d ? playerName(d.owner_player_id) : "",
        d?.name ?? "",
        v.version_no,
        v.started_on,
        v.note,
        v.list_url,
        playerName(v.created_by),
        v.created_at,
      ]);
    }
  } else if (entity === "players") {
    rows = [["Player ID", "Name", "Email", "Role", "Active"]];
    for (const p of data.players) rows.push([p.player_id, p.display_name, p.email, p.role, p.active ? "Yes" : "No"]);
  } else {
    rows = [["Deck ID", "Owner ID", "Owner", "Name", "Colors", "Bracket", "Commanders", "Companion", "Commander status", "Active", "Notes", "List URL", "Current version"]];
    for (const d of data.decks) {
      const cmds = data.commanders.filter((c) => c.deck_id === d.deck_id);
      const label = (c: (typeof cmds)[number]) => c.card_name || c.typed_name;
      rows.push([
        d.deck_id,
        d.owner_player_id,
        playerName(d.owner_player_id),
        d.name,
        d.colors,
        d.bracket,
        cmds.filter((c) => c.role !== "companion").map(label).join(" + "),
        cmds.filter((c) => c.role === "companion").map(label).join(""),
        d.commander_status,
        d.active ? "Yes" : "No",
        d.notes,
        d.list_url,
        1 + data.versions.filter((v) => v.deck_id === d.deck_id).length,
      ]);
    }
  }
  await audit(db, gid, actor, "export", entity, "export", undefined, { rows: rows.length - 1 });
  return toCsv(rows);
}
