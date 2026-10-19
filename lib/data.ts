import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canApprove, canEditDeck, canEditGame, canManageLookups, canManagePlayers, isAdmin } from "./permissions";
import {
  BRACKETS,
  GUEST_PLAYER_ID,
  MAX_SEATS,
  MIN_SEATS,
  normalizeColors,
  parse,
  serialize,
  type CommanderStatus,
  type Deck,
  type DeckCommander,
  type Game,
  type GameSeat,
  type GameWithSeats,
  type Lookup,
  type Player,
  type RawRow,
  type TabName,
} from "./schema";
import { getStore } from "./store";
import { slugify } from "./util";

export class AppError extends Error {}
/** Thrown when a save is based on an older rev than the sheet holds. */
export class StaleError extends AppError {
  constructor() {
    super("Someone else changed this game since you opened it. Reload and try again.");
  }
}

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

export { slugify };

// ---------------------------------------------------------------------------
// Reference-data cache. Players, decks and lookups change rarely and are read
// on every page; games are always read fresh.

const CACHE_MS = 60_000;
const cache = new Map<TabName, { at: number; rows: Promise<{ index: number; data: RawRow }[]> }>();
const CACHED: TabName[] = ["Players", "Decks", "DeckCommanders", "WinConditions", "Rules"];

async function rows(tab: TabName) {
  if (!CACHED.includes(tab)) return getStore().getRows(tab);
  const hit = cache.get(tab);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const p = getStore().getRows(tab);
  cache.set(tab, { at: Date.now(), rows: p });
  p.catch(() => cache.delete(tab));
  return p;
}

export function invalidate(...tabs: TabName[]) {
  for (const t of tabs.length ? tabs : CACHED) cache.delete(t);
}

async function audit(actor: Player | string, entity: string, entityId: string, action: string, before: unknown, after: unknown) {
  await getStore().appendRows("AuditLog", [
    {
      timestamp: new Date().toISOString(),
      user: typeof actor === "string" ? actor : actor.player_id,
      entity,
      entity_id: entityId,
      action,
      before: before === undefined ? "" : JSON.stringify(before),
      after: after === undefined ? "" : JSON.stringify(after),
    },
  ]);
}

// ---------------------------------------------------------------------------
// Reads

export async function listPlayers(opts: { includeInactive?: boolean } = {}): Promise<Player[]> {
  const all = (await rows("Players")).map((r) => parse.player(r.data)).filter((p) => p.player_id);
  return all
    .filter((p) => opts.includeInactive || p.active)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export async function getPlayerByEmail(email: string): Promise<Player | null> {
  const e = email.trim().toLowerCase();
  return (await listPlayers({ includeInactive: true })).find((p) => p.email === e && p.active) ?? null;
}

export async function getPlayer(id: string): Promise<Player | null> {
  return (await listPlayers({ includeInactive: true })).find((p) => p.player_id === id) ?? null;
}

export async function listDecks(opts: { owner?: string; includeInactive?: boolean } = {}): Promise<Deck[]> {
  return (await rows("Decks"))
    .map((r) => parse.deck(r.data))
    .filter((d) => d.deck_id && (opts.includeInactive || d.active) && (!opts.owner || d.owner_player_id === opts.owner))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDeck(id: string): Promise<Deck | null> {
  return (await listDecks({ includeInactive: true })).find((d) => d.deck_id === id) ?? null;
}

export async function listDeckCommanders(deckId?: string): Promise<DeckCommander[]> {
  return (await rows("DeckCommanders"))
    .map((r) => parse.deckCommander(r.data))
    .filter((c) => !deckId || c.deck_id === deckId)
    .sort((a, b) => a.slot - b.slot);
}

export async function listWinConditions(): Promise<Lookup[]> {
  return (await rows("WinConditions")).map((r) => parse.lookup(r.data)).filter((l) => l.id);
}

export async function listRules(): Promise<Lookup[]> {
  return (await rows("Rules")).map((r) => parse.lookup(r.data)).filter((l) => l.id);
}

function attachSeats(games: Game[], seats: GameSeat[]): GameWithSeats[] {
  const byGame = new Map<string, GameSeat[]>();
  for (const s of seats) {
    const list = byGame.get(s.game_id) ?? [];
    list.push(s);
    byGame.set(s.game_id, list);
  }
  return games.map((g) => ({ ...g, seats: (byGame.get(g.game_id) ?? []).sort((a, b) => a.seat - b.seat) }));
}

export interface GameFilter {
  from?: string;
  to?: string;
  playerId?: string;
  status?: Game["status"] | Game["status"][];
}

export async function listGames(filter: GameFilter = {}): Promise<GameWithSeats[]> {
  const [gameRows, seatRows] = await Promise.all([rows("Games"), rows("GameSeats")]);
  const statuses = filter.status ? [filter.status].flat() : undefined;
  const games = gameRows
    .map((r) => parse.game(r.data))
    .filter(
      (g) =>
        g.game_id &&
        (!statuses || statuses.includes(g.status)) &&
        (!filter.from || g.date >= filter.from) &&
        (!filter.to || g.date <= filter.to),
    );
  let out = attachSeats(games, seatRows.map((r) => parse.seat(r.data)));
  if (filter.playerId) out = out.filter((g) => g.seats.some((s) => s.player_id === filter.playerId));
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.day_game_no - a.day_game_no);
}

export async function getGame(id: string): Promise<GameWithSeats | null> {
  const [gameRows, seatRows] = await Promise.all([rows("Games"), rows("GameSeats")]);
  const g = gameRows.map((r) => parse.game(r.data)).find((x) => x.game_id === id);
  if (!g) return null;
  return attachSeats([g], seatRows.map((r) => parse.seat(r.data)).filter((s) => s.game_id === id))[0];
}

// ---------------------------------------------------------------------------
// Games

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const gameInputSchema = z.object({
  date: isoDate,
  result: z.enum(["won", "draw", "unfinished"]),
  brackets: z.array(z.enum(BRACKETS)).default([]),
  win_conditions: z.array(z.string()).default([]),
  additional_rules: z.array(z.string()).default([]),
  notes: z.string().max(2000).default(""),
  seats: z
    .array(
      z.object({
        player_id: z.string().min(1, "Every seat needs a player"),
        deck_id: z.string().default(""),
        is_winner: z.boolean().default(false),
      }),
    )
    .min(MIN_SEATS, `A game needs at least ${MIN_SEATS} players`)
    .max(MAX_SEATS, `A game can have at most ${MAX_SEATS} players`),
});
export type GameInput = z.input<typeof gameInputSchema>;

/** Validate and normalise a game against current players, decks and lookups. */
export async function validateGame(input: GameInput) {
  const parsed = gameInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues.map((i) => i.message).join("; "));
  const g = parsed.data;
  const [players, decks, wcs, rules] = await Promise.all([
    listPlayers({ includeInactive: true }),
    listDecks({ includeInactive: true }),
    listWinConditions(),
    listRules(),
  ]);
  const playerIds = new Set(players.map((p) => p.player_id));
  const deckById = new Map(decks.map((d) => [d.deck_id, d]));
  const seen = new Set<string>();

  const seats = g.seats.map((s, i) => {
    const guest = s.player_id === GUEST_PLAYER_ID;
    if (!guest && !playerIds.has(s.player_id)) throw new AppError(`Seat ${i + 1}: unknown player`);
    if (!guest && seen.has(s.player_id)) throw new AppError(`Seat ${i + 1}: a player can only sit once`);
    seen.add(s.player_id);
    if (!guest) {
      if (!s.deck_id) throw new AppError(`Seat ${i + 1}: choose a deck`);
      if (!deckById.has(s.deck_id)) throw new AppError(`Seat ${i + 1}: unknown deck`);
    }
    return {
      seat: i + 1,
      player_id: s.player_id,
      deck_id: guest ? "" : s.deck_id,
      is_winner: g.result === "won" ? s.is_winner : false,
    };
  });

  if (g.result === "won" && !seats.some((s) => s.is_winner)) {
    throw new AppError("Pick the winner, or mark the game as a draw or unfinished");
  }
  const wcIds = new Set(wcs.map((w) => w.id));
  const ruleIds = new Set(rules.map((r) => r.id));
  const badWc = g.win_conditions.find((w) => !wcIds.has(w));
  if (badWc) throw new AppError(`Unknown win condition ${badWc}`);
  const badRule = g.additional_rules.find((r) => !ruleIds.has(r));
  if (badRule) throw new AppError(`Unknown rule ${badRule}`);

  return {
    date: g.date,
    result: g.result,
    brackets: [...new Set(g.brackets)].sort(),
    win_conditions: g.result === "won" ? [...new Set(g.win_conditions)] : [],
    additional_rules: [...new Set(g.additional_rules)],
    notes: g.notes.trim(),
    seats,
  };
}

/** Next number for a date: the previous game that day plus 1, starting at 1. */
export function nextDayGameNo(games: Pick<Game, "date" | "day_game_no">[], date: string) {
  return games.filter((g) => g.date === date).reduce((max, g) => Math.max(max, g.day_game_no), 0) + 1;
}

export async function createGame(input: GameInput, actor: Player): Promise<GameWithSeats> {
  const v = await validateGame(input);
  const existing = (await rows("Games")).map((r) => parse.game(r.data));
  const admin = isAdmin(actor);
  const game: Game = {
    game_id: newId("g"),
    day_game_no: nextDayGameNo(existing, v.date),
    date: v.date,
    status: admin ? "approved" : "pending",
    result: v.result,
    brackets: v.brackets,
    win_conditions: v.win_conditions,
    additional_rules: v.additional_rules,
    notes: v.notes,
    submitted_by: actor.player_id,
    approved_by: admin ? actor.player_id : "",
    rev: 1,
    reject_reason: "",
  };
  const seats: GameSeat[] = v.seats.map((s) => ({ ...s, game_id: game.game_id }));
  const store = getStore();
  await store.appendRows("Games", [serialize.game(game)]);
  await store.appendRows("GameSeats", seats.map(serialize.seat));
  await audit(actor, "game", game.game_id, "create", undefined, { ...game, seats });
  return { ...game, seats };
}

async function findGameRow(id: string) {
  const r = (await getStore().getRows("Games")).find((x) => x.data.game_id === id);
  if (!r) throw new AppError("Game not found");
  return r;
}

async function replaceSeats(gameId: string, seats: GameSeat[]) {
  const store = getStore();
  const old = (await store.getRows("GameSeats")).filter((r) => r.data.game_id === gameId).map((r) => r.index);
  await store.deleteRows("GameSeats", old);
  await store.appendRows("GameSeats", seats.map(serialize.seat));
}

export async function updateGame(id: string, input: GameInput, expectedRev: number, actor: Player) {
  const before = await getGame(id);
  if (!before) throw new AppError("Game not found");
  if (!canEditGame(actor, before)) throw new AppError("You can only edit games you played in");
  const v = await validateGame(input);

  const row = await findGameRow(id);
  const current = parse.game(row.data);
  if (current.rev !== expectedRev) throw new StaleError();

  const admin = isAdmin(actor);
  const existing = (await rows("Games")).map((r) => parse.game(r.data)).filter((g) => g.game_id !== id);
  // A player's edit sends the game back to the queue; an admin's keeps its state.
  const status = admin ? current.status : "pending";
  const next: Game = {
    ...current,
    date: v.date,
    day_game_no: v.date === current.date ? current.day_game_no : nextDayGameNo(existing, v.date),
    result: v.result,
    brackets: v.brackets,
    win_conditions: v.win_conditions,
    additional_rules: v.additional_rules,
    notes: v.notes,
    status,
    approved_by: status === "approved" ? current.approved_by : "",
    reject_reason: status === "rejected" ? current.reject_reason : "",
    rev: current.rev + 1,
  };
  const seats: GameSeat[] = v.seats.map((s) => ({ ...s, game_id: id }));
  await getStore().updateRow("Games", row.index, serialize.game(next));
  await replaceSeats(id, seats);
  await audit(actor, "game", id, "update", before, { ...next, seats });
  return { ...next, seats };
}

async function setGameStatus(id: string, actor: Player, status: Game["status"], reason = "") {
  if (!canApprove(actor)) throw new AppError("Only admins can approve or reject games");
  const row = await findGameRow(id);
  const before = parse.game(row.data);
  const next: Game = {
    ...before,
    status,
    approved_by: status === "approved" ? actor.player_id : "",
    reject_reason: status === "rejected" ? reason.trim() : "",
    rev: before.rev + 1,
  };
  await getStore().updateRow("Games", row.index, serialize.game(next));
  await audit(actor, "game", id, status === "approved" ? "approve" : status === "rejected" ? "reject" : "reopen", before, next);
  return next;
}

export const approveGame = (id: string, actor: Player) => setGameStatus(id, actor, "approved");
export async function rejectGame(id: string, actor: Player, reason: string) {
  if (!reason.trim()) throw new AppError("Give a reason for rejecting");
  return setGameStatus(id, actor, "rejected", reason);
}

export async function deleteGame(id: string, actor: Player) {
  if (!isAdmin(actor)) throw new AppError("Only admins can delete games");
  const before = await getGame(id);
  if (!before) throw new AppError("Game not found");
  const row = await findGameRow(id);
  await getStore().deleteRows("Games", [row.index]);
  await replaceSeats(id, []);
  await audit(actor, "game", id, "delete", before, undefined);
}

// ---------------------------------------------------------------------------
// Decks

const commanderInput = z.object({
  role: z.enum(["commander", "partner", "companion"]),
  scryfall_oracle_id: z.string().default(""),
  card_name: z.string().default(""),
  typed_name: z.string().default(""),
});

export const deckInputSchema = z.object({
  owner_player_id: z.string().min(1),
  name: z.string().trim().min(1, "Give the deck a name").max(80),
  colors: z.string().default(""),
  bracket: z.union([z.enum(BRACKETS), z.literal("")]).default(""),
  notes: z.string().max(2000).default(""),
  commanders: z.array(commanderInput).max(3).default([]),
});
export type DeckInput = z.input<typeof deckInputSchema>;

export function commanderStatusFor(cmds: Pick<DeckCommander, "role" | "scryfall_oracle_id">[]): CommanderStatus {
  const main = cmds.filter((c) => c.role !== "companion");
  if (main.length === 0) return "unresolved";
  return main.every((c) => c.scryfall_oracle_id) ? "resolved" : "unresolved";
}

function normalizeCommanders(deckId: string, cmds: z.infer<typeof commanderInput>[]): DeckCommander[] {
  const main = cmds.filter((c) => c.role !== "companion" && (c.card_name || c.typed_name));
  const companion = cmds.find((c) => c.role === "companion" && (c.card_name || c.typed_name));
  if (main.length > 2) throw new AppError("A deck has at most two commanders");
  const out: DeckCommander[] = main.map((c, i) => ({
    deck_id: deckId,
    slot: i + 1,
    role: i === 0 ? "commander" : "partner",
    scryfall_oracle_id: c.scryfall_oracle_id,
    card_name: c.scryfall_oracle_id ? c.card_name : "",
    typed_name: c.typed_name || c.card_name,
  }));
  if (companion) {
    out.push({
      deck_id: deckId,
      slot: 3,
      role: "companion",
      scryfall_oracle_id: companion.scryfall_oracle_id,
      card_name: companion.scryfall_oracle_id ? companion.card_name : "",
      typed_name: companion.typed_name || companion.card_name,
    });
  }
  return out;
}

async function assertUniqueDeckName(owner: string, name: string, exceptId?: string) {
  const clash = (await listDecks({ owner, includeInactive: true })).find(
    (d) => d.deck_id !== exceptId && d.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (clash) throw new AppError(`That player already has a deck called ${clash.name}`);
}

async function replaceCommanders(deckId: string, cmds: DeckCommander[]) {
  const store = getStore();
  const old = (await store.getRows("DeckCommanders")).filter((r) => r.data.deck_id === deckId).map((r) => r.index);
  await store.deleteRows("DeckCommanders", old);
  await store.appendRows("DeckCommanders", cmds.map(serialize.deckCommander));
}

export async function createDeck(input: DeckInput, actor: Player): Promise<Deck> {
  const parsed = deckInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues.map((i) => i.message).join("; "));
  const d = parsed.data;
  if (!canEditDeck(actor, d)) throw new AppError("You can only add your own decks");
  if (!(await getPlayer(d.owner_player_id))) throw new AppError("Unknown owner");
  await assertUniqueDeckName(d.owner_player_id, d.name);
  const deck_id = newId("d");
  const cmds = normalizeCommanders(deck_id, d.commanders);
  const deck: Deck = {
    deck_id,
    owner_player_id: d.owner_player_id,
    name: d.name.trim(),
    colors: normalizeColors(d.colors),
    bracket: d.bracket,
    notes: d.notes.trim(),
    commander_status: commanderStatusFor(cmds),
    active: true,
  };
  const store = getStore();
  await store.appendRows("Decks", [serialize.deck(deck)]);
  await store.appendRows("DeckCommanders", cmds.map(serialize.deckCommander));
  invalidate("Decks", "DeckCommanders");
  await audit(actor, "deck", deck_id, "create", undefined, { ...deck, commanders: cmds });
  return deck;
}

export async function updateDeck(id: string, input: DeckInput & { active?: boolean }, actor: Player): Promise<Deck> {
  const parsed = deckInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues.map((i) => i.message).join("; "));
  const d = parsed.data;
  const store = getStore();
  const row = (await store.getRows("Decks")).find((r) => r.data.deck_id === id);
  if (!row) throw new AppError("Deck not found");
  const before = parse.deck(row.data);
  if (!canEditDeck(actor, before) || !canEditDeck(actor, d)) throw new AppError("You can only edit your own decks");
  await assertUniqueDeckName(d.owner_player_id, d.name, id);
  const cmds = normalizeCommanders(id, d.commanders);
  const next: Deck = {
    ...before,
    owner_player_id: d.owner_player_id,
    name: d.name.trim(),
    colors: normalizeColors(d.colors),
    bracket: d.bracket,
    notes: d.notes.trim(),
    commander_status: commanderStatusFor(cmds),
    active: input.active ?? before.active,
  };
  const beforeCmds = await listDeckCommanders(id);
  await store.updateRow("Decks", row.index, serialize.deck(next));
  await replaceCommanders(id, cmds);
  invalidate("Decks", "DeckCommanders");
  await audit(actor, "deck", id, "update", { ...before, commanders: beforeCmds }, { ...next, commanders: cmds });
  return next;
}

// ---------------------------------------------------------------------------
// Players and lookups (admin)

export async function upsertPlayer(
  input: { player_id?: string; display_name: string; email: string; role: Player["role"]; active: boolean },
  actor: Player,
): Promise<Player> {
  if (!canManagePlayers(actor)) throw new AppError("Only admins can manage players");
  const name = input.display_name.trim();
  if (!name) throw new AppError("Name is required");
  const email = input.email.trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+$/.test(email)) throw new AppError("That email doesn't look right");
  const store = getStore();
  const all = await store.getRows("Players");
  const players = all.map((r) => parse.player(r.data));
  if (email && players.some((p) => p.email === email && p.player_id !== input.player_id)) {
    throw new AppError("Another player already uses that email");
  }
  if (input.player_id) {
    const row = all.find((r) => r.data.player_id === input.player_id);
    if (!row) throw new AppError("Player not found");
    const before = parse.player(row.data);
    if (before.player_id === actor.player_id && (input.role !== "admin" || !input.active)) {
      throw new AppError("You can't remove your own admin access");
    }
    const next: Player = { ...before, display_name: name, email, role: input.role, active: input.active };
    await store.updateRow("Players", row.index, serialize.player(next));
    invalidate("Players");
    await audit(actor, "player", next.player_id, "update", before, next);
    return next;
  }
  let id = slugify(name);
  const taken = new Set([...players.map((p) => p.player_id), GUEST_PLAYER_ID.toLowerCase()]);
  for (let i = 2; taken.has(id); i++) id = `${slugify(name)}-${i}`;
  const p: Player = { player_id: id, display_name: name, email, role: input.role, active: input.active };
  await store.appendRows("Players", [serialize.player(p)]);
  invalidate("Players");
  await audit(actor, "player", id, "create", undefined, p);
  return p;
}

export async function upsertLookup(tab: "WinConditions" | "Rules", input: { id?: string; name: string }, actor: Player) {
  if (!canManageLookups(actor)) throw new AppError("Only admins can manage lookups");
  const name = input.name.trim();
  if (!name) throw new AppError("Name is required");
  const store = getStore();
  const all = await store.getRows(tab);
  if (input.id) {
    const row = all.find((r) => r.data.id === input.id);
    if (!row) throw new AppError("Not found");
    const next = { id: input.id, name };
    await store.updateRow(tab, row.index, next);
    invalidate(tab);
    await audit(actor, tab, input.id, "update", row.data, next);
    return next;
  }
  let id = slugify(name);
  const taken = new Set(all.map((r) => r.data.id));
  for (let i = 2; taken.has(id); i++) id = `${slugify(name)}-${i}`;
  const next = { id, name };
  await store.appendRows(tab, [next]);
  invalidate(tab);
  await audit(actor, tab, id, "create", undefined, next);
  return next;
}

export async function listAudit(limit = 200) {
  const all = await getStore().getRows("AuditLog");
  return all
    .map((r) => r.data)
    .reverse()
    .slice(0, limit);
}
