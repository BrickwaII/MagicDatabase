import { GUEST_PLAYER_ID, POD_SIZES, type GameWithSeats } from "./schema";

export interface StatsFilter {
  /** Only count games with these pod sizes; empty = all. */
  podSizes?: number[];
  /** Only count games tagged with at least one of these brackets; empty = all. */
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
      (f.brackets.length === 0 || g.brackets.some((b) => f.brackets.includes(b))) &&
      !g.additional_rules.some((r) => f.ignoredRules.includes(r)),
  );
}

const rate = (wins: number, games: number) => (games === 0 ? 0 : wins / games);

export interface PlayerStat {
  player_id: string;
  games: number;
  wins: number;
  winRate: number;
}

export function playerStats(games: GameWithSeats[], filter: StatsFilter = {}): PlayerStat[] {
  const f = { ...DEFAULT_FILTER, ...filter };
  const map = new Map<string, PlayerStat>();
  for (const g of countedGames(games, f)) {
    for (const s of g.seats) {
      if (f.ignoredPlayers.includes(s.player_id)) continue;
      const st = map.get(s.player_id) ?? { player_id: s.player_id, games: 0, wins: 0, winRate: 0 };
      st.games++;
      if (s.is_winner) st.wins++;
      map.set(s.player_id, st);
    }
  }
  return [...map.values()]
    .map((s) => ({ ...s, winRate: rate(s.wins, s.games) }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

export interface DeckStat {
  deck_id: string;
  player_id: string;
  games: number;
  wins: number;
  winRate: number;
  lastPlayed: string;
}

/** Per deck, per pilot (a borrowed deck shows up once per player). */
export function deckStats(games: GameWithSeats[], filter: StatsFilter = {}): DeckStat[] {
  const f = { ...DEFAULT_FILTER, ...filter };
  const map = new Map<string, DeckStat>();
  for (const g of countedGames(games, f)) {
    for (const s of g.seats) {
      if (!s.deck_id || f.ignoredPlayers.includes(s.player_id)) continue;
      const key = `${s.player_id}|${s.deck_id}`;
      const st = map.get(key) ?? {
        deck_id: s.deck_id,
        player_id: s.player_id,
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
  return [...map.values()]
    .map((s) => ({ ...s, winRate: rate(s.wins, s.games) }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate);
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
