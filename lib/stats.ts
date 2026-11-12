import { GUEST_PLAYER_ID, POD_SIZES, type GameWithSeats, type VersionRef } from "./schema";

export interface StatsFilter {
  /** Only count games with these pod sizes; empty = all. */
  podSizes?: number[];
  /**
   * Only count games tagged with at least one of these brackets; empty = all.
   * Games with no bracket recorded always pass (most imported games have none).
   */
  brackets?: string[];
  /** Drop games that used any of these additional rules. */
  ignoredRules?: string[];
  /** Hide these players from the tables (their games still count for others). */
  ignoredPlayers?: string[];
}

export const DEFAULT_FILTER: Required<StatsFilter> = {
  podSizes: [],
  brackets: [],
  ignoredRules: [],
  ignoredPlayers: [GUEST_PLAYER_ID],
};

/**
 * Games that count: approved and with a result of "won". Draws and unfinished
 * games are kept for history but excluded from every stat, as if never played.
 */
export function countedGames(games: GameWithSeats[], filter: StatsFilter = {}) {
  const f = { ...DEFAULT_FILTER, ...filter };
  return games.filter(
    (g) =>
      g.status === "approved" &&
      g.result === "won" &&
      (f.podSizes.length === 0 || f.podSizes.includes(g.seats.length)) &&
      (f.brackets.length === 0 || g.brackets.length === 0 || g.brackets.some((b) => f.brackets.includes(b))) &&
      !g.additional_rules.some((r) => f.ignoredRules.includes(r)),
  );
}

const rate = (wins: number, games: number) => (games === 0 ? 0 : wins / games);

/**
 * The win rate you'd expect from pod sizes alone: the average over these games
 * of 1 / (number of seats), so a 3-player and a 4-player game give
 * (1/3 + 1/4) / 2. Pass the games a player (or deck) was counted in. 0 for none.
 */
export function expectedWinRate(games: { seats: unknown[] }[]): number {
  const played = games.filter((g) => g.seats.length > 0);
  if (played.length === 0) return 0;
  return played.reduce((sum, g) => sum + 1 / g.seats.length, 0) / played.length;
}

export interface PlayerStat {
  player_id: string;
  games: number;
  wins: number;
  winRate: number;
  /** Expected win rate from the pod sizes of the same counted games (see expectedWinRate). */
  expected: number;
}

export function playerStats(games: GameWithSeats[], filter: StatsFilter = {}): PlayerStat[] {
  const f = { ...DEFAULT_FILTER, ...filter };
  const map = new Map<string, PlayerStat & { played: GameWithSeats[] }>();
  for (const g of countedGames(games, f)) {
    for (const s of g.seats) {
      if (f.ignoredPlayers.includes(s.player_id)) continue;
      const st = map.get(s.player_id) ?? { player_id: s.player_id, games: 0, wins: 0, winRate: 0, expected: 0, played: [] };
      st.games++;
      if (s.is_winner) st.wins++;
      st.played.push(g);
      map.set(s.player_id, st);
    }
  }
  return [...map.values()]
    .map(({ played, ...s }) => ({ ...s, winRate: rate(s.wins, s.games), expected: expectedWinRate(played) }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

// ---------------------------------------------------------------------------
// Deck versions

/** Group versions by deck, each list sorted by started_on. */
export function versionsByDeck(versions: VersionRef[]): Map<string, VersionRef[]> {
  const m = new Map<string, VersionRef[]>();
  for (const v of versions) m.set(v.deck_id, [...(m.get(v.deck_id) ?? []), v]);
  for (const list of m.values()) list.sort((a, b) => a.started_on.localeCompare(b.started_on));
  return m;
}

/**
 * The version of a deck a game on `date` used: the latest version that started
 * on or before that date (a game on the day of a change counts toward the new
 * version), or 1 when no change had been logged yet. `versions` is one deck's.
 */
export function versionOn(versions: VersionRef[], date: string): number {
  let v = 1;
  for (const x of versions) if (x.started_on <= date && x.version_no > v) v = x.version_no;
  return v;
}

export interface VersionStat {
  version_no: number;
  /** "" for version 1 (it starts with the deck). */
  started_on: string;
  /** Day before the next version started, or "" for the current version. */
  until: string;
  games: number;
  wins: number;
  winRate: number;
  expected: number;
  firstPlayed: string;
  lastPlayed: string;
}

const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/**
 * One deck's record per version (all pilots), from counted games only, oldest
 * version first. Version 1 is always included, even with no games.
 */
export function deckVersionStats(games: GameWithSeats[], deckId: string, versions: VersionRef[], filter: StatsFilter = {}): VersionStat[] {
  const mine = [...versions.filter((v) => v.deck_id === deckId)].sort((a, b) => a.version_no - b.version_no);
  const rows: (VersionStat & { played: GameWithSeats[] })[] = [{ version_no: 1, started_on: "" }, ...mine].map((v, i, all) => ({
    version_no: v.version_no,
    started_on: v.started_on,
    until: all[i + 1] ? dayBefore(all[i + 1].started_on) : "",
    games: 0,
    wins: 0,
    winRate: 0,
    expected: 0,
    firstPlayed: "",
    lastPlayed: "",
    played: [],
  }));
  for (const g of countedGames(games, { ...filter, ignoredPlayers: [] })) {
    const seats = g.seats.filter((s) => s.deck_id === deckId);
    if (seats.length === 0) continue;
    const row = rows.find((r) => r.version_no === versionOn(mine, g.date))!;
    for (const s of seats) {
      row.games++;
      if (s.is_winner) row.wins++;
      row.played.push(g);
    }
    if (!row.firstPlayed || g.date < row.firstPlayed) row.firstPlayed = g.date;
    if (g.date > row.lastPlayed) row.lastPlayed = g.date;
  }
  return rows.map(({ played, ...r }) => ({ ...r, winRate: rate(r.wins, r.games), expected: expectedWinRate(played) }));
}

export interface DeckStat {
  deck_id: string;
  player_id: string;
  /** Set when split by version. */
  version_no?: number;
  games: number;
  wins: number;
  winRate: number;
  lastPlayed: string;
}

/**
 * Per deck, per pilot (a borrowed deck shows up once per player). With
 * `versions`, also split by deck version (one row per deck, pilot and version).
 */
export function deckStats(games: GameWithSeats[], filter: StatsFilter = {}, versions?: VersionRef[]): DeckStat[] {
  const f = { ...DEFAULT_FILTER, ...filter };
  const byDeck = versions ? versionsByDeck(versions) : undefined;
  const map = new Map<string, DeckStat>();
  for (const g of countedGames(games, f)) {
    for (const s of g.seats) {
      if (!s.deck_id || f.ignoredPlayers.includes(s.player_id)) continue;
      const version_no = byDeck ? versionOn(byDeck.get(s.deck_id) ?? [], g.date) : undefined;
      const key = `${s.player_id}|${s.deck_id}|${version_no ?? ""}`;
      const st = map.get(key) ?? {
        deck_id: s.deck_id,
        player_id: s.player_id,
        ...(version_no === undefined ? {} : { version_no }),
        games: 0,
        wins: 0,
        winRate: 0,
        lastPlayed: "",
      };
      st.games++;
      if (s.is_winner) st.wins++;
      if (g.date > st.lastPlayed) st.lastPlayed = g.date;
      map.set(key, st);
    }
  }
  const rows = [...map.values()].map((s) => ({ ...s, winRate: rate(s.wins, s.games) }));
  if (!byDeck) return rows.sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  // Split by version: keep each deck's versions together (most-played deck first), oldest version first.
  const pair = (s: DeckStat) => `${s.player_id}|${s.deck_id}`;
  const total = new Map<string, number>();
  for (const s of rows) total.set(pair(s), (total.get(pair(s)) ?? 0) + s.games);
  return rows.sort(
    (a, b) =>
      total.get(pair(b))! - total.get(pair(a))! || pair(a).localeCompare(pair(b)) || (a.version_no ?? 1) - (b.version_no ?? 1),
  );
}

export interface SeatRow {
  seat: number;
  played: number;
  wins: number;
  /** wins in this seat / games played in this seat */
  winRate: number;
  /** share of all games of this pod size played from this seat */
  pctPlayed: number;
  /** share of all wins of this pod size that came from this seat */
  pctWon: number;
}

export interface SeatTable {
  podSize: number;
  games: number;
  seats: SeatRow[];
}

function seatTable(podSize: number, entries: { seat: number; won: boolean }[], games: number): SeatTable {
  const totalWins = entries.filter((e) => e.won).length;
  const seats: SeatRow[] = [];
  for (let seat = 1; seat <= podSize; seat++) {
    const here = entries.filter((e) => e.seat === seat);
    const wins = here.filter((e) => e.won).length;
    seats.push({
      seat,
      played: here.length,
      wins,
      winRate: rate(wins, here.length),
      pctPlayed: rate(here.length, entries.length),
      pctWon: rate(wins, totalWins),
    });
  }
  return { podSize, games, seats };
}

/** Seat win rates for each pod size, across all players. */
export function seatStats(games: GameWithSeats[], filter: StatsFilter = {}): SeatTable[] {
  const counted = countedGames(games, filter);
  return POD_SIZES.map((n) => {
    const pod = counted.filter((g) => g.seats.length === n);
    const entries = pod.flatMap((g) => g.seats.map((s) => ({ seat: s.seat, won: s.is_winner })));
    return seatTable(n, entries, pod.length);
  }).filter((t) => t.games > 0);
}

/** One player's seat split: how often they sat in each seat vs where their wins came from. */
export function playerSeatStats(games: GameWithSeats[], playerId: string, filter: StatsFilter = {}): SeatTable[] {
  const counted = countedGames(games, filter);
  return POD_SIZES.map((n) => {
    const entries = counted
      .filter((g) => g.seats.length === n)
      .flatMap((g) => g.seats.filter((s) => s.player_id === playerId).map((s) => ({ seat: s.seat, won: s.is_winner })));
    return seatTable(n, entries, entries.length);
  }).filter((t) => t.games > 0);
}

export function summary(games: GameWithSeats[], filter: StatsFilter = {}) {
  const counted = countedGames(games, filter);
  return {
    counted: counted.length,
    draws: games.filter((g) => g.status === "approved" && g.result === "draw").length,
    unfinished: games.filter((g) => g.status === "approved" && g.result === "unfinished").length,
    pending: games.filter((g) => g.status === "pending").length,
  };
}
