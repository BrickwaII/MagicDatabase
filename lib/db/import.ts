// Writes a migration result (lib/migrate.ts) into Postgres for one group.
// Kept apart from the parsing in lib/migrate.ts so the two can change independently.
//
// Rerunnable: migrated rows have stable ids (m_..., d_...). Players' emails and
// roles, deck curation, and commanders already linked in the database are kept.
// Games entered through the app (ids not starting with m_) are kept, but only
// with `force`.
import { asc, eq } from "drizzle-orm";
import { commanderValues, deckValues, gameValues, seatValues } from "../data";
import type { MigrationResult } from "../migrate";
import type { Deck, DeckCommander, DeckVersion, Game, GameSeat, Lookup, Player } from "../schema";
import { versionValues } from "../versions";
import type { Db, Tx } from "./index";
import {
  auditLog,
  deckCommanders,
  decks,
  deckVersions,
  gameRules,
  games,
  gameSeats,
  gameWinConditions,
  players,
  rules,
  winConditions,
} from "./schema";

type Conn = Db | Tx;

export interface GroupData {
  players: Player[];
  decks: Deck[];
  deckCommanders: DeckCommander[];
  /** Changes logged in the app; the old sheet has none (its decks are all v1). */
  deckVersions: DeckVersion[];
  games: Game[];
  seats: GameSeat[];
  winConditions: Lookup[];
  rules: Lookup[];
}

export const isMigratedGameId = (id: string) => id.startsWith("m_");

/** Everything stored for a group, in app shapes. */
export async function readGroupData(db: Conn, gid: string): Promise<GroupData> {
  const [p, d, c, g, s, wc, r, gwc, gr, dv] = await Promise.all([
    db.select().from(players).where(eq(players.groupId, gid)),
    db.select().from(decks).where(eq(decks.groupId, gid)),
    db.select().from(deckCommanders).where(eq(deckCommanders.groupId, gid)).orderBy(asc(deckCommanders.slot)),
    db.select().from(games).where(eq(games.groupId, gid)).orderBy(asc(games.date), asc(games.dayGameNo)),
    db.select().from(gameSeats).where(eq(gameSeats.groupId, gid)).orderBy(asc(gameSeats.seat)),
    db.select().from(winConditions).where(eq(winConditions.groupId, gid)).orderBy(asc(winConditions.seq)),
    db.select().from(rules).where(eq(rules.groupId, gid)).orderBy(asc(rules.seq)),
    db.select().from(gameWinConditions).where(eq(gameWinConditions.groupId, gid)).orderBy(asc(gameWinConditions.position)),
    db.select().from(gameRules).where(eq(gameRules.groupId, gid)).orderBy(asc(gameRules.position)),
    db.select().from(deckVersions).where(eq(deckVersions.groupId, gid)).orderBy(asc(deckVersions.deckId), asc(deckVersions.versionNo)),
  ]);
  return {
    players: p.map((x) => ({ player_id: x.id, display_name: x.displayName, email: x.email ?? "", role: x.role, active: x.active })),
    decks: d.map((x) => ({
      deck_id: x.id,
      owner_player_id: x.ownerPlayerId,
      name: x.name,
      colors: x.colors,
      bracket: x.bracket === null ? "" : String(x.bracket),
      notes: x.notes,
      commander_status: x.commanderStatus,
      active: x.active,
      list_url: x.listUrl ?? "",
    })),
    deckCommanders: c.map((x) => ({
      deck_id: x.deckId,
      slot: x.slot,
      role: x.role,
      scryfall_oracle_id: x.scryfallOracleId ?? "",
      card_name: x.cardName,
      typed_name: x.typedName,
    })),
    games: g.map((x) => ({
      game_id: x.id,
      day_game_no: x.dayGameNo,
      date: x.date,
      status: x.status,
      result: x.result,
      brackets: [...x.brackets].sort((a, b) => a - b).map(String),
      win_conditions: gwc.filter((w) => w.gameId === x.id).map((w) => w.winConditionId),
      additional_rules: gr.filter((w) => w.gameId === x.id).map((w) => w.ruleId),
      notes: x.notes,
      submitted_by: x.submittedBy,
      approved_by: x.approvedBy ?? "",
      rev: x.rev,
      reject_reason: x.rejectReason ?? "",
    })),
    seats: s.map((x) => ({
      game_id: x.gameId,
      seat: x.seat,
      player_id: x.playerId ?? "RANDOM",
      deck_id: x.deckId ?? "",
      is_winner: x.isWinner,
      guest_name: x.guestName ?? "",
      guest_deck: x.guestDeck ?? "",
      guest_added_by: x.guestAddedBy ?? "",
    })),
    deckVersions: dv.map((x) => ({
      id: x.id,
      deck_id: x.deckId,
      version_no: x.versionNo,
      started_on: x.startedOn,
      note: x.note,
      list_url: x.listUrl ?? "",
      created_by: x.createdBy,
      created_at: x.createdAt.toISOString(),
    })),
    winConditions: wc.map((x) => ({ id: x.id, name: x.name })),
    rules: r.map((x) => ({ id: x.id, name: x.name })),
  };
}

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 500) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

/**
 * Replace a group's players, decks, lookups and games with `data`, in one
 * transaction. The audit log is left alone.
 */
export async function replaceGroupData(tx: Conn, gid: string, data: GroupData) {
  // Children first, then parents.
  await tx.delete(gameWinConditions).where(eq(gameWinConditions.groupId, gid));
  await tx.delete(gameRules).where(eq(gameRules.groupId, gid));
  await tx.delete(gameSeats).where(eq(gameSeats.groupId, gid));
  await tx.delete(games).where(eq(games.groupId, gid));
  await tx.delete(deckVersions).where(eq(deckVersions.groupId, gid));
  await tx.delete(deckCommanders).where(eq(deckCommanders.groupId, gid));
  await tx.delete(decks).where(eq(decks.groupId, gid));
  await tx.delete(players).where(eq(players.groupId, gid));
  await tx.delete(winConditions).where(eq(winConditions.groupId, gid));
  await tx.delete(rules).where(eq(rules.groupId, gid));

  await insertChunked(data.players, (c) =>
    tx.insert(players).values(
      c.map((p) => ({
        groupId: gid,
        id: p.player_id,
        displayName: p.display_name,
        email: p.email.trim().toLowerCase() || null,
        role: p.role,
        active: p.active,
      })),
    ),
  );
  await insertChunked(data.winConditions, (c) => tx.insert(winConditions).values(c.map((l) => ({ groupId: gid, ...l }))));
  await insertChunked(data.rules, (c) => tx.insert(rules).values(c.map((l) => ({ groupId: gid, ...l }))));
  await insertChunked(data.decks, (c) => tx.insert(decks).values(c.map((d) => deckValues(gid, d))));
  await insertChunked(data.deckCommanders, (c) => tx.insert(deckCommanders).values(c.map((x) => commanderValues(gid, x))));
  await insertChunked(data.deckVersions, (c) => tx.insert(deckVersions).values(c.map((x) => versionValues(gid, x))));
  await insertChunked(data.games, (c) => tx.insert(games).values(c.map((g) => gameValues(gid, g))));
  await insertChunked(data.seats, (c) => tx.insert(gameSeats).values(c.map((s) => seatValues(gid, s))));
  const wcLinks = data.games.flatMap((g) =>
    [...new Set(g.win_conditions)].map((w, i) => ({ groupId: gid, gameId: g.game_id, winConditionId: w, position: i })),
  );
  const ruleLinks = data.games.flatMap((g) =>
    [...new Set(g.additional_rules)].map((r, i) => ({ groupId: gid, gameId: g.game_id, ruleId: r, position: i })),
  );
  await insertChunked(wcLinks, (c) => tx.insert(gameWinConditions).values(c));
  await insertChunked(ruleLinks, (c) => tx.insert(gameRules).values(c));
}

export class AppGamesExistError extends Error {
  constructor(public count: number) {
    super(
      `The database already has ${count} games entered through the app. Re-run with --force to keep them and re-import the rest.`,
    );
  }
}

/** Merge a fresh migration result with what the group already holds (pure). */
export function mergeImport(res: MigrationResult, current: GroupData, opts: { force?: boolean } = {}) {
  const warnings: string[] = [];
  const appGames = current.games.filter((g) => !isMigratedGameId(g.game_id));
  if (appGames.length && !opts.force) throw new AppGamesExistError(appGames.length);

  const players = res.players.map((p) => current.players.find((c) => c.player_id === p.player_id) ?? p);
  players.push(...current.players.filter((c) => !players.some((p) => p.player_id === c.player_id)));

  const decks = res.decks.map((d) => {
    const c = current.decks.find((x) => x.deck_id === d.deck_id);
    return c
      ? {
          ...d,
          commander_status: c.commander_status,
          bracket: c.bracket || d.bracket,
          notes: c.notes || d.notes,
          active: c.active,
          list_url: c.list_url || d.list_url,
        }
      : { ...d };
  });
  decks.push(...current.decks.filter((c) => !decks.some((d) => d.deck_id === c.deck_id)));

  // Commanders: keep the database's links for decks it already has.
  const curatedDecks = new Set(current.deckCommanders.filter((c) => c.scryfall_oracle_id).map((c) => c.deck_id));
  const deckCommanders = [
    ...res.deckCommanders.filter((c) => !curatedDecks.has(c.deck_id)),
    ...current.deckCommanders.filter((c) => curatedDecks.has(c.deck_id) || !res.decks.some((d) => d.deck_id === c.deck_id)),
  ];
  for (const d of decks) {
    if (curatedDecks.has(d.deck_id)) {
      d.commander_status = current.decks.find((x) => x.deck_id === d.deck_id)?.commander_status ?? d.commander_status;
    }
  }

  const mergeLookups = (a: Lookup[], b: Lookup[]) => [...b, ...a.filter((x) => !b.some((y) => y.id === x.id))];

  // App games keep their day number unless a migrated game now holds it.
  const taken = new Set(res.games.map((g) => `${g.date}#${g.day_game_no}`));
  const keptGames = appGames.map((g) => {
    let no = g.day_game_no;
    while (taken.has(`${g.date}#${no}`)) no++;
    if (no !== g.day_game_no) warnings.push(`App game ${g.game_id} (${g.date}) renumbered from #${g.day_game_no} to #${no}.`);
    taken.add(`${g.date}#${no}`);
    return { ...g, day_game_no: no };
  });
  const keptIds = new Set(keptGames.map((g) => g.game_id));

  const data: GroupData = {
    players,
    decks,
    deckCommanders,
    // Versions logged in the app are kept for every deck that still exists.
    deckVersions: current.deckVersions.filter((v) => decks.some((d) => d.deck_id === v.deck_id)),
    winConditions: mergeLookups(res.winConditions, current.winConditions),
    rules: mergeLookups(res.rules, current.rules),
    games: [...res.games, ...keptGames],
    seats: [...res.seats, ...current.seats.filter((s) => keptIds.has(s.game_id))],
  };
  return { data, appGames: keptGames.length, warnings };
}

/** Import into the group, in one transaction. */
export async function importMigration(db: Db, gid: string, res: MigrationResult, opts: { force?: boolean } = {}) {
  return db.transaction(async (tx) => {
    const current = await readGroupData(tx, gid);
    const merged = mergeImport(res, current, opts);
    await replaceGroupData(tx, gid, merged.data);
    await tx.insert(auditLog).values({
      groupId: gid,
      actor: "import",
      entity: "migration",
      entityId: "",
      action: "import",
      after: { games: res.games.length, decks: res.decks.length, players: res.players.length, keptAppGames: merged.appGames },
    });
    return merged;
  });
}

/** Count of rows per table for a group (reports and tests). */
export async function countGroupRows(db: Conn, gid: string) {
  const d = await readGroupData(db, gid);
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, (v as unknown[]).length])) as Record<keyof GroupData, number>;
}
