import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, exists, gte, inArray, isNull, lte, max, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db, type Tx } from "./db";
import { currentGroupId } from "./db/group";
import {
  auditLog,
  deckCommanders,
  decks,
  gameRules,
  games,
  gameSeats,
  gameWinConditions,
  players,
  rules,
  winConditions,
} from "./db/schema";
import { canApprove, canEditDeck, canEditGame, canManageLookups, canManagePlayers, isAdmin } from "./permissions";
import {
  BRACKETS,
  GUEST_PLAYER_ID,
  MAX_SEATS,
  MIN_SEATS,
  normalizeColors,
  type AuditEntry,
  type CommanderStatus,
  type Deck,
  type DeckCommander,
  type Game,
  type GameSeat,
  type GameWithSeats,
  type Lookup,
  type Player,
} from "./schema";
import { slugify } from "./util";

export class AppError extends Error {}
/** Thrown when a save is based on an older rev than the database holds. */
export class StaleError extends AppError {
  constructor() {
    super("Someone else changed this game since you opened it. Reload and try again.");
  }
}

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

export { slugify };

type Conn = Db | Tx;

async function ctx(): Promise<{ db: Db; gid: string }> {
  const db = await getDb();
  return { db, gid: await currentGroupId(db) };
}

/** Postgres error code, looking through Drizzle's wrapper. */
export function pgErrorCode(e: unknown): string | undefined {
  for (let x = e as { code?: unknown; cause?: unknown } | undefined, i = 0; x && i < 5; x = x.cause as typeof x, i++) {
    if (typeof x.code === "string") return x.code;
  }
  return undefined;
}

async function audit(
  db: Conn,
  gid: string,
  actor: Player | string,
  entity: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  await db.insert(auditLog).values({
    groupId: gid,
    actor: typeof actor === "string" ? actor : actor.player_id,
    entity,
    entityId,
    action,
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
  });
}

// ---------------------------------------------------------------------------
// Row mapping

type PlayerRow = typeof players.$inferSelect;
type DeckRow = typeof decks.$inferSelect;
type CmdRow = typeof deckCommanders.$inferSelect;
type GameRow = typeof games.$inferSelect;
type SeatRow = typeof gameSeats.$inferSelect;

const toPlayer = (r: PlayerRow): Player => ({
  player_id: r.id,
  display_name: r.displayName,
  email: r.email ?? "",
  role: r.role,
  active: r.active,
});

const toDeck = (r: DeckRow): Deck => ({
  deck_id: r.id,
  owner_player_id: r.ownerPlayerId,
  name: r.name,
  colors: r.colors,
  bracket: r.bracket === null ? "" : String(r.bracket),
  notes: r.notes,
  commander_status: r.commanderStatus,
  active: r.active,
});

const toCommander = (r: CmdRow): DeckCommander => ({
  deck_id: r.deckId,
  slot: r.slot,
  role: r.role,
  scryfall_oracle_id: r.scryfallOracleId ?? "",
  card_name: r.cardName,
  typed_name: r.typedName,
});

const toSeat = (r: SeatRow): GameSeat => ({
  game_id: r.gameId,
  seat: r.seat,
  player_id: r.playerId ?? GUEST_PLAYER_ID,
  deck_id: r.deckId ?? "",
  is_winner: r.isWinner,
});

const toGame = (r: GameRow, wcs: string[], rls: string[]): Game => ({
  game_id: r.id,
  day_game_no: r.dayGameNo,
  date: r.date,
  status: r.status,
  result: r.result,
  brackets: [...r.brackets].sort((a, b) => a - b).map(String),
  win_conditions: wcs,
  additional_rules: rls,
  notes: r.notes,
  submitted_by: r.submittedBy,
  approved_by: r.approvedBy ?? "",
  rev: r.rev,
  reject_reason: r.rejectReason ?? "",
});

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

// ---------------------------------------------------------------------------
// Reads

export async function listPlayers(opts: { includeInactive?: boolean } = {}): Promise<Player[]> {
  const { db, gid } = await ctx();
  const where = opts.includeInactive ? eq(players.groupId, gid) : and(eq(players.groupId, gid), eq(players.active, true));
  const all = (await db.select().from(players).where(where)).map(toPlayer);
  return all.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export async function getPlayerByEmail(email: string): Promise<Player | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const { db, gid } = await ctx();
  const [row] = await db
    .select()
    .from(players)
    .where(and(eq(players.groupId, gid), eq(players.email, e), eq(players.active, true)));
  return row ? toPlayer(row) : null;
}

export async function getPlayer(id: string): Promise<Player | null> {
  const { db, gid } = await ctx();
  const [row] = await db.select().from(players).where(and(eq(players.groupId, gid), eq(players.id, id)));
  return row ? toPlayer(row) : null;
}

export async function listDecks(opts: { owner?: string; includeInactive?: boolean } = {}): Promise<Deck[]> {
  const { db, gid } = await ctx();
  const conds: SQL[] = [eq(decks.groupId, gid)];
  if (!opts.includeInactive) conds.push(eq(decks.active, true));
  if (opts.owner) conds.push(eq(decks.ownerPlayerId, opts.owner));
  return (await db.select().from(decks).where(and(...conds))).map(toDeck).sort(byName);
}

export async function getDeck(id: string): Promise<Deck | null> {
  const { db, gid } = await ctx();
  const [row] = await db.select().from(decks).where(and(eq(decks.groupId, gid), eq(decks.id, id)));
  return row ? toDeck(row) : null;
}

export async function listDeckCommanders(deckId?: string): Promise<DeckCommander[]> {
  const { db, gid } = await ctx();
  const where = deckId
    ? and(eq(deckCommanders.groupId, gid), eq(deckCommanders.deckId, deckId))
    : eq(deckCommanders.groupId, gid);
  return (await db.select().from(deckCommanders).where(where).orderBy(asc(deckCommanders.slot))).map(toCommander);
}

export async function listWinConditions(): Promise<Lookup[]> {
  const { db, gid } = await ctx();
  return db
    .select({ id: winConditions.id, name: winConditions.name })
    .from(winConditions)
    .where(eq(winConditions.groupId, gid))
    .orderBy(asc(winConditions.seq));
}

export async function listRules(): Promise<Lookup[]> {
  const { db, gid } = await ctx();
  return db.select({ id: rules.id, name: rules.name }).from(rules).where(eq(rules.groupId, gid)).orderBy(asc(rules.seq));
}

export interface GameFilter {
  from?: string;
  to?: string;
  playerId?: string;
  status?: Game["status"] | Game["status"][];
}

/** Load games matching `where` (already group-scoped) with their seats, win conditions and rules. */
async function loadGames(db: Conn, gid: string, where: SQL): Promise<GameWithSeats[]> {
  const gameRows = await db.select().from(games).where(where).orderBy(desc(games.date), desc(games.dayGameNo));
  if (gameRows.length === 0) return [];
  const ids = db.select({ id: games.id }).from(games).where(where);
  const [seatRows, wcRows, ruleRows] = await Promise.all([
    db
      .select()
      .from(gameSeats)
      .where(and(eq(gameSeats.groupId, gid), inArray(gameSeats.gameId, ids)))
      .orderBy(asc(gameSeats.gameId), asc(gameSeats.seat)),
    db
      .select()
      .from(gameWinConditions)
      .where(and(eq(gameWinConditions.groupId, gid), inArray(gameWinConditions.gameId, ids)))
      .orderBy(asc(gameWinConditions.position)),
    db
      .select()
      .from(gameRules)
      .where(and(eq(gameRules.groupId, gid), inArray(gameRules.gameId, ids)))
      .orderBy(asc(gameRules.position)),
  ]);
  const group = <T, K>(list: T[], key: (x: T) => string, val: (x: T) => K) => {
    const m = new Map<string, K[]>();
    for (const x of list) {
      const arr = m.get(key(x)) ?? [];
      arr.push(val(x));
      m.set(key(x), arr);
    }
    return m;
  };
  const seatsBy = group(seatRows, (s) => s.gameId, toSeat);
  const wcsBy = group(wcRows, (w) => w.gameId, (w) => w.winConditionId);
  const rulesBy = group(ruleRows, (r) => r.gameId, (r) => r.ruleId);
  return gameRows.map((g) => ({
    ...toGame(g, wcsBy.get(g.id) ?? [], rulesBy.get(g.id) ?? []),
    seats: seatsBy.get(g.id) ?? [],
  }));
}

export async function listGames(filter: GameFilter = {}): Promise<GameWithSeats[]> {
  const { db, gid } = await ctx();
  const conds: SQL[] = [eq(games.groupId, gid)];
  const statuses = filter.status ? [filter.status].flat() : undefined;
  if (statuses) conds.push(inArray(games.status, statuses));
  if (filter.from) conds.push(gte(games.date, filter.from));
  if (filter.to) conds.push(lte(games.date, filter.to));
  if (filter.playerId) {
    const seatPlayer =
      filter.playerId === GUEST_PLAYER_ID ? isNull(gameSeats.playerId) : eq(gameSeats.playerId, filter.playerId);
    conds.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(gameSeats)
          .where(and(eq(gameSeats.groupId, games.groupId), eq(gameSeats.gameId, games.id), seatPlayer)),
      ),
    );
  }
  return loadGames(db, gid, and(...conds)!);
}

export async function getGame(id: string): Promise<GameWithSeats | null> {
  const { db, gid } = await ctx();
  return (await loadGames(db, gid, and(eq(games.groupId, gid), eq(games.id, id))!))[0] ?? null;
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
  const real = new Date(`${g.date}T00:00:00Z`);
  if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== g.date) throw new AppError("That date doesn't exist");
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

async function nextDayGameNoDb(tx: Conn, gid: string, date: string, exceptId?: string) {
  const conds = [eq(games.groupId, gid), eq(games.date, date)];
  if (exceptId) conds.push(ne(games.id, exceptId));
  const [row] = await tx.select({ n: max(games.dayGameNo) }).from(games).where(and(...conds));
  return (row?.n ?? 0) + 1;
}

/** Write a game's seats, win conditions and rules, replacing whatever was there. */
async function writeGameChildren(tx: Conn, gid: string, game: Game, seats: GameSeat[]) {
  const id = game.game_id;
  await tx.delete(gameSeats).where(and(eq(gameSeats.groupId, gid), eq(gameSeats.gameId, id)));
  await tx.delete(gameWinConditions).where(and(eq(gameWinConditions.groupId, gid), eq(gameWinConditions.gameId, id)));
  await tx.delete(gameRules).where(and(eq(gameRules.groupId, gid), eq(gameRules.gameId, id)));
  if (seats.length) await tx.insert(gameSeats).values(seats.map((s) => seatValues(gid, s)));
  if (game.win_conditions.length) {
    await tx
      .insert(gameWinConditions)
      .values(game.win_conditions.map((w, i) => ({ groupId: gid, gameId: id, winConditionId: w, position: i })));
  }
  if (game.additional_rules.length) {
    await tx
      .insert(gameRules)
      .values(game.additional_rules.map((r, i) => ({ groupId: gid, gameId: id, ruleId: r, position: i })));
  }
}

export const seatValues = (gid: string, s: GameSeat): typeof gameSeats.$inferInsert => ({
  groupId: gid,
  gameId: s.game_id,
  seat: s.seat,
  playerId: s.player_id === GUEST_PLAYER_ID ? null : s.player_id,
  deckId: s.player_id === GUEST_PLAYER_ID || !s.deck_id ? null : s.deck_id,
  isWinner: s.is_winner,
});

export const gameValues = (gid: string, g: Game): typeof games.$inferInsert => ({
  groupId: gid,
  id: g.game_id,
  dayGameNo: g.day_game_no,
  date: g.date,
  status: g.status,
  result: g.result,
  brackets: g.brackets.map(Number).filter((n) => n >= 1 && n <= 5),
  notes: g.notes,
  submittedBy: g.submitted_by,
  approvedBy: g.approved_by || null,
  rev: g.rev,
  rejectReason: g.reject_reason || null,
});

/** Retry a transaction that lost a race for a day_game_no. */
async function retryOnDayNoClash<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 5 || pgErrorCode(e) !== "23505") throw e;
    }
  }
}

export async function createGame(input: GameInput, actor: Player): Promise<GameWithSeats> {
  const v = await validateGame(input);
  const { db, gid } = await ctx();
  const admin = isAdmin(actor);
  const game_id = newId("g");
  return retryOnDayNoClash(() =>
    db.transaction(async (tx) => {
      const game: Game = {
        game_id,
        day_game_no: await nextDayGameNoDb(tx, gid, v.date),
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
      const seats: GameSeat[] = v.seats.map((s) => ({ ...s, game_id }));
      await tx.insert(games).values(gameValues(gid, game));
      await writeGameChildren(tx, gid, game, seats);
      await audit(tx, gid, actor, "game", game_id, "create", undefined, { ...game, seats });
      return { ...game, seats };
    }),
  );
}

async function lockGame(tx: Conn, gid: string, id: string): Promise<Game> {
  const [row] = await tx
    .select()
    .from(games)
    .where(and(eq(games.groupId, gid), eq(games.id, id)))
    .for("update");
  if (!row) throw new AppError("Game not found");
  const [loaded] = await loadGames(tx, gid, and(eq(games.groupId, gid), eq(games.id, id))!);
  return loaded;
}

export async function updateGame(id: string, input: GameInput, expectedRev: number, actor: Player) {
  const before = await getGame(id);
  if (!before) throw new AppError("Game not found");
  if (!canEditGame(actor, before)) throw new AppError("You can only edit games you played in");
  const v = await validateGame(input);
  const { db, gid } = await ctx();

  return retryOnDayNoClash(() =>
    db.transaction(async (tx) => {
      const current = await lockGame(tx, gid, id);
      if (current.rev !== expectedRev) throw new StaleError();
      const admin = isAdmin(actor);
      // A player's edit sends the game back to the queue; an admin's keeps its state.
      const status = admin ? current.status : "pending";
      const { seats: _old, ...currentGame } = current as GameWithSeats;
      void _old;
      const next: Game = {
        ...currentGame,
        date: v.date,
        day_game_no: v.date === current.date ? current.day_game_no : await nextDayGameNoDb(tx, gid, v.date, id),
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
      const { groupId: _g, id: _i, ...values } = gameValues(gid, next);
      void _g;
      void _i;
      // The rev condition makes the check atomic even without the row lock.
      const updated = await tx
        .update(games)
        .set({ ...values, updatedAt: sql`now()` })
        .where(and(eq(games.groupId, gid), eq(games.id, id), eq(games.rev, expectedRev)))
        .returning({ id: games.id });
      if (updated.length === 0) throw new StaleError();
      const seats: GameSeat[] = v.seats.map((s) => ({ ...s, game_id: id }));
      await writeGameChildren(tx, gid, next, seats);
      await audit(tx, gid, actor, "game", id, "update", before, { ...next, seats });
      return { ...next, seats };
    }),
  );
}

async function setGameStatus(id: string, actor: Player, status: Game["status"], reason = "") {
  if (!canApprove(actor)) throw new AppError("Only admins can approve or reject games");
  const { db, gid } = await ctx();
  return db.transaction(async (tx) => {
    const { seats: _s, ...before } = (await lockGame(tx, gid, id)) as GameWithSeats;
    void _s;
    const next: Game = {
      ...before,
      status,
      approved_by: status === "approved" ? actor.player_id : "",
      reject_reason: status === "rejected" ? reason.trim() : "",
      rev: before.rev + 1,
    };
    const updated = await tx
      .update(games)
      .set({
        status,
        approvedBy: next.approved_by || null,
        rejectReason: next.reject_reason || null,
        rev: next.rev,
        updatedAt: sql`now()`,
      })
      .where(and(eq(games.groupId, gid), eq(games.id, id), eq(games.rev, before.rev)))
      .returning({ id: games.id });
    if (updated.length === 0) throw new StaleError();
    const action = status === "approved" ? "approve" : status === "rejected" ? "reject" : "reopen";
    await audit(tx, gid, actor, "game", id, action, before, next);
    return next;
  });
}

export const approveGame = (id: string, actor: Player) => setGameStatus(id, actor, "approved");
export async function rejectGame(id: string, actor: Player, reason: string) {
  if (!reason.trim()) throw new AppError("Give a reason for rejecting");
  return setGameStatus(id, actor, "rejected", reason);
}

export async function deleteGame(id: string, actor: Player) {
  if (!isAdmin(actor)) throw new AppError("Only admins can delete games");
  const { db, gid } = await ctx();
  await db.transaction(async (tx) => {
    const before = await lockGame(tx, gid, id);
    // Seats, win conditions and rules go with it (ON DELETE CASCADE).
    await tx.delete(games).where(and(eq(games.groupId, gid), eq(games.id, id)));
    await audit(tx, gid, actor, "game", id, "delete", before, undefined);
  });
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

export const deckValues = (gid: string, d: Deck): typeof decks.$inferInsert => ({
  groupId: gid,
  id: d.deck_id,
  ownerPlayerId: d.owner_player_id,
  name: d.name,
  colors: d.colors || "C",
  bracket: /^[1-5]$/.test(d.bracket) ? Number(d.bracket) : null,
  notes: d.notes,
  commanderStatus: d.commander_status,
  active: d.active,
});

export const commanderValues = (gid: string, c: DeckCommander): typeof deckCommanders.$inferInsert => ({
  groupId: gid,
  deckId: c.deck_id,
  slot: c.slot,
  role: c.role,
  scryfallOracleId: c.scryfall_oracle_id || null,
  cardName: c.card_name,
  typedName: c.typed_name,
});

async function assertUniqueDeckName(tx: Conn, gid: string, owner: string, name: string, exceptId?: string) {
  const conds = [
    eq(decks.groupId, gid),
    eq(decks.ownerPlayerId, owner),
    sql`lower(trim(${decks.name})) = ${name.trim().toLowerCase()}`,
  ];
  if (exceptId) conds.push(ne(decks.id, exceptId));
  const [clash] = await tx.select({ name: decks.name }).from(decks).where(and(...conds)).limit(1);
  if (clash) throw new AppError(`That player already has a deck called ${clash.name}`);
}

async function replaceCommanders(tx: Conn, gid: string, deckId: string, cmds: DeckCommander[]) {
  await tx.delete(deckCommanders).where(and(eq(deckCommanders.groupId, gid), eq(deckCommanders.deckId, deckId)));
  if (cmds.length) await tx.insert(deckCommanders).values(cmds.map((c) => commanderValues(gid, c)));
}

export async function createDeck(input: DeckInput, actor: Player): Promise<Deck> {
  const parsed = deckInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues.map((i) => i.message).join("; "));
  const d = parsed.data;
  if (!canEditDeck(actor, d)) throw new AppError("You can only add your own decks");
  if (!(await getPlayer(d.owner_player_id))) throw new AppError("Unknown owner");
  const { db, gid } = await ctx();
  return db.transaction(async (tx) => {
    await assertUniqueDeckName(tx, gid, d.owner_player_id, d.name);
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
    await tx.insert(decks).values(deckValues(gid, deck));
    await replaceCommanders(tx, gid, deck_id, cmds);
    await audit(tx, gid, actor, "deck", deck_id, "create", undefined, { ...deck, commanders: cmds });
    return deck;
  });
}

export async function updateDeck(id: string, input: DeckInput & { active?: boolean }, actor: Player): Promise<Deck> {
  const parsed = deckInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues.map((i) => i.message).join("; "));
  const d = parsed.data;
  const { db, gid } = await ctx();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(decks)
      .where(and(eq(decks.groupId, gid), eq(decks.id, id)))
      .for("update");
    if (!row) throw new AppError("Deck not found");
    const before = toDeck(row);
    if (!canEditDeck(actor, before) || !canEditDeck(actor, d)) throw new AppError("You can only edit your own decks");
    if (d.owner_player_id !== before.owner_player_id) {
      const [owner] = await tx
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.groupId, gid), eq(players.id, d.owner_player_id)));
      if (!owner) throw new AppError("Unknown owner");
    }
    await assertUniqueDeckName(tx, gid, d.owner_player_id, d.name, id);
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
    const beforeCmds = (
      await tx
        .select()
        .from(deckCommanders)
        .where(and(eq(deckCommanders.groupId, gid), eq(deckCommanders.deckId, id)))
        .orderBy(asc(deckCommanders.slot))
    ).map(toCommander);
    const { groupId: _g, id: _i, ...values } = deckValues(gid, next);
    void _g;
    void _i;
    await tx.update(decks).set(values).where(and(eq(decks.groupId, gid), eq(decks.id, id)));
    await replaceCommanders(tx, gid, id, cmds);
    await audit(tx, gid, actor, "deck", id, "update", { ...before, commanders: beforeCmds }, { ...next, commanders: cmds });
    return next;
  });
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
  const { db, gid } = await ctx();
  return db.transaction(async (tx) => {
    const all = (await tx.select().from(players).where(eq(players.groupId, gid))).map(toPlayer);
    if (email && all.some((p) => p.email === email && p.player_id !== input.player_id)) {
      throw new AppError("Another player already uses that email");
    }
    if (input.player_id) {
      const before = all.find((p) => p.player_id === input.player_id);
      if (!before) throw new AppError("Player not found");
      if (before.player_id === actor.player_id && (input.role !== "admin" || !input.active)) {
        throw new AppError("You can't remove your own admin access");
      }
      const next: Player = { ...before, display_name: name, email, role: input.role, active: input.active };
      await tx
        .update(players)
        .set({ displayName: name, email: email || null, role: input.role, active: input.active })
        .where(and(eq(players.groupId, gid), eq(players.id, before.player_id)));
      await audit(tx, gid, actor, "player", next.player_id, "update", before, next);
      return next;
    }
    let id = slugify(name);
    const taken = new Set([...all.map((p) => p.player_id), GUEST_PLAYER_ID.toLowerCase()]);
    for (let i = 2; taken.has(id); i++) id = `${slugify(name)}-${i}`;
    const p: Player = { player_id: id, display_name: name, email, role: input.role, active: input.active };
    await tx.insert(players).values({ groupId: gid, id, displayName: name, email: email || null, role: p.role, active: p.active });
    await audit(tx, gid, actor, "player", id, "create", undefined, p);
    return p;
  });
}

export async function upsertLookup(tab: "WinConditions" | "Rules", input: { id?: string; name: string }, actor: Player) {
  if (!canManageLookups(actor)) throw new AppError("Only admins can manage lookups");
  const name = input.name.trim();
  if (!name) throw new AppError("Name is required");
  const table = tab === "Rules" ? rules : winConditions;
  const { db, gid } = await ctx();
  return db.transaction(async (tx) => {
    const all = await tx.select({ id: table.id, name: table.name }).from(table).where(eq(table.groupId, gid));
    if (input.id) {
      const before = all.find((r) => r.id === input.id);
      if (!before) throw new AppError("Not found");
      const next = { id: input.id, name };
      await tx.update(table).set({ name }).where(and(eq(table.groupId, gid), eq(table.id, input.id)));
      await audit(tx, gid, actor, tab, input.id, "update", before, next);
      return next;
    }
    let id = slugify(name);
    const taken = new Set(all.map((r) => r.id));
    for (let i = 2; taken.has(id); i++) id = `${slugify(name)}-${i}`;
    const next = { id, name };
    await tx.insert(table).values({ groupId: gid, id, name });
    await audit(tx, gid, actor, tab, id, "create", undefined, next);
    return next;
  });
}

export async function listAudit(limit = 200): Promise<AuditEntry[]> {
  const { db, gid } = await ctx();
  const rows = await db.select().from(auditLog).where(eq(auditLog.groupId, gid)).orderBy(desc(auditLog.id)).limit(limit);
  const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));
  return rows.map((r) => ({
    timestamp: r.at.toISOString(),
    user: r.actor,
    entity: r.entity,
    entity_id: r.entityId,
    action: r.action,
    before: json(r.before),
    after: json(r.after),
  }));
}
