// Spreadsheet layout: one tab per entity, one row per record, a header row,
// no merged cells, no formulas. Column order here is the order written to the
// sheet; reads map columns by header name so a reordered sheet still works.

export const TABS = {
  Players: ["player_id", "display_name", "email", "role", "active"],
  Decks: [
    "deck_id",
    "owner_player_id",
    "name",
    "colors",
    "bracket",
    "notes",
    "commander_status",
    "active",
  ],
  DeckCommanders: ["deck_id", "slot", "role", "scryfall_oracle_id", "card_name", "typed_name"],
  Games: [
    "game_id",
    "day_game_no",
    "date",
    "status",
    "result",
    "brackets",
    "win_conditions",
    "additional_rules",
    "notes",
    "submitted_by",
    "approved_by",
    "rev",
    "reject_reason",
  ],
  GameSeats: ["game_id", "seat", "player_id", "deck_id", "is_winner"],
  WinConditions: ["id", "name"],
  Rules: ["id", "name"],
  AuditLog: ["timestamp", "user", "entity", "entity_id", "action", "before", "after"],
} as const;

export type TabName = keyof typeof TABS;
export type RawRow = Record<string, string>;

/** Guest seats use this player_id and never carry a deck. */
export const GUEST_PLAYER_ID = "RANDOM";

export const BRACKETS = ["1", "2", "3", "4", "5"] as const;
export const POD_SIZES = [3, 4, 5, 6] as const;
export const MIN_SEATS = 3;
export const MAX_SEATS = 6;

export type Role = "player" | "admin";
export type GameStatus = "pending" | "approved" | "rejected";
export type GameResult = "won" | "draw" | "unfinished";
export type CommanderStatus = "resolved" | "unresolved" | "none";
export type CommanderRole = "commander" | "partner" | "companion";

export interface Player {
  player_id: string;
  display_name: string;
  email: string;
  role: Role;
  active: boolean;
}

export interface Deck {
  deck_id: string;
  owner_player_id: string;
  name: string;
  /** Color identity as letters in WUBRG order, or "C" for colorless. */
  colors: string;
  bracket: string;
  notes: string;
  commander_status: CommanderStatus;
  active: boolean;
}

export interface DeckCommander {
  deck_id: string;
  slot: number;
  role: CommanderRole;
  scryfall_oracle_id: string;
  card_name: string;
  typed_name: string;
}

export interface GameSeat {
  game_id: string;
  seat: number;
  player_id: string;
  deck_id: string;
  is_winner: boolean;
}

export interface Game {
  game_id: string;
  day_game_no: number;
  /** ISO date, YYYY-MM-DD */
  date: string;
  status: GameStatus;
  result: GameResult;
  brackets: string[];
  win_conditions: string[];
  additional_rules: string[];
  notes: string;
  submitted_by: string;
  approved_by: string;
  rev: number;
  reject_reason: string;
}

export interface GameWithSeats extends Game {
  seats: GameSeat[];
}

export interface Lookup {
  id: string;
  name: string;
}

export interface AuditEntry {
  timestamp: string;
  user: string;
  entity: string;
  entity_id: string;
  action: string;
  before: string;
  after: string;
}

// ---------------------------------------------------------------------------
// Row <-> record conversion

const bool = (v: string | undefined) => /^(true|yes|1)$/i.test((v ?? "").trim());
const int = (v: string | undefined, fallback = 0) => {
  const n = parseInt((v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
};
export const splitList = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const joinList = (v: string[]) => v.join(", ");

function oneOf<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T {
  const s = (v ?? "").trim().toLowerCase() as T;
  return allowed.includes(s) ? s : fallback;
}

export const parse = {
  player: (r: RawRow): Player => ({
    player_id: r.player_id ?? "",
    display_name: r.display_name ?? "",
    email: (r.email ?? "").trim().toLowerCase(),
    role: oneOf(r.role, ["player", "admin"] as const, "player"),
    active: r.active === undefined || r.active === "" ? true : bool(r.active),
  }),
  deck: (r: RawRow): Deck => ({
    deck_id: r.deck_id ?? "",
    owner_player_id: r.owner_player_id ?? "",
    name: r.name ?? "",
    colors: r.colors ?? "",
    bracket: r.bracket ?? "",
    notes: r.notes ?? "",
    commander_status: oneOf(r.commander_status, ["resolved", "unresolved", "none"] as const, "none"),
    active: r.active === undefined || r.active === "" ? true : bool(r.active),
  }),
  deckCommander: (r: RawRow): DeckCommander => ({
    deck_id: r.deck_id ?? "",
    slot: int(r.slot, 1),
    role: oneOf(r.role, ["commander", "partner", "companion"] as const, "commander"),
    scryfall_oracle_id: r.scryfall_oracle_id ?? "",
    card_name: r.card_name ?? "",
    typed_name: r.typed_name ?? "",
  }),
  game: (r: RawRow): Game => ({
    game_id: r.game_id ?? "",
    day_game_no: int(r.day_game_no, 1),
    date: r.date ?? "",
    status: oneOf(r.status, ["pending", "approved", "rejected"] as const, "pending"),
    result: oneOf(r.result, ["won", "draw", "unfinished"] as const, "won"),
    brackets: splitList(r.brackets),
    win_conditions: splitList(r.win_conditions),
    additional_rules: splitList(r.additional_rules),
    notes: r.notes ?? "",
    submitted_by: r.submitted_by ?? "",
    approved_by: r.approved_by ?? "",
    rev: int(r.rev, 1),
    reject_reason: r.reject_reason ?? "",
  }),
  seat: (r: RawRow): GameSeat => ({
    game_id: r.game_id ?? "",
    seat: int(r.seat, 1),
    player_id: r.player_id ?? "",
    deck_id: r.deck_id ?? "",
    is_winner: bool(r.is_winner),
  }),
  lookup: (r: RawRow): Lookup => ({ id: r.id ?? "", name: r.name ?? "" }),
};

const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export const serialize = {
  player: (p: Player): RawRow => ({ ...p, active: s(p.active) }),
  deck: (d: Deck): RawRow => ({ ...d, active: s(d.active) }),
  deckCommander: (c: DeckCommander): RawRow => ({ ...c, slot: s(c.slot) }),
  game: (g: Game): RawRow => ({
    ...g,
    day_game_no: s(g.day_game_no),
    rev: s(g.rev),
    brackets: joinList(g.brackets),
    win_conditions: joinList(g.win_conditions),
    additional_rules: joinList(g.additional_rules),
  }),
  seat: (x: GameSeat): RawRow => ({ ...x, seat: s(x.seat), is_winner: s(x.is_winner) }),
  lookup: (l: Lookup): RawRow => ({ ...l }),
};

export const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;

/** Normalise any mix of color letters into WUBRG order; empty or only C → "C". */
export function normalizeColors(input: string | string[]): string {
  const letters = new Set(
    (Array.isArray(input) ? input.join("") : input).toUpperCase().replace(/[^WUBRGC]/g, "").split(""),
  );
  const out = COLOR_ORDER.filter((c) => letters.has(c)).join("");
  return out || "C";
}
