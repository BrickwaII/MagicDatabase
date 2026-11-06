// App-level record types shared by pages, the data layer and the migration.
// Storage tables live in lib/db/schema.ts; lib/data.ts maps between the two.

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
  /** ISO timestamp */
  timestamp: string;
  user: string;
  entity: string;
  entity_id: string;
  action: string;
  before: string;
  after: string;
}

export const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;

/** Normalise any mix of color letters into WUBRG order; empty or only C → "C". */
export function normalizeColors(input: string | string[]): string {
  const letters = new Set(
    (Array.isArray(input) ? input.join("") : input).toUpperCase().replace(/[^WUBRGC]/g, "").split(""),
  );
  const out = COLOR_ORDER.filter((c) => letters.has(c)).join("");
  return out || "C";
}
