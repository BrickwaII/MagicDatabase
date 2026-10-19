import { describe, expect, it } from "vitest";
import type { GameWithSeats } from "@/lib/schema";
import { countedGames, deckStats, playerSeatStats, playerStats, seatStats } from "@/lib/stats";

let n = 0;
function game(seats: [string, string, boolean][], over: Partial<GameWithSeats> = {}): GameWithSeats {
  const id = `g${n++}`;
  return {
    game_id: id,
    day_game_no: 1,
    date: "2026-01-03",
    status: "approved",
    result: "won",
    brackets: ["3"],
    win_conditions: [],
    additional_rules: [],
    notes: "",
    submitted_by: "a",
    approved_by: "a",
    rev: 1,
    reject_reason: "",
    seats: seats.map(([player_id, deck_id, is_winner], i) => ({ game_id: id, seat: i + 1, player_id, deck_id, is_winner })),
    ...over,
  };
}

const games = [
  game([["a", "da", true], ["b", "db", false], ["c", "dc", false]]),
  game([["b", "db", true], ["a", "da", false], ["c", "dc", false], ["RANDOM", "", false]]),
  game([["a", "da2", false], ["b", "db", false], ["c", "dc", true]], { date: "2026-02-01" }),
  game([["a", "da", false], ["b", "db", false], ["c", "dc", false]], { result: "draw" }),
  game([["a", "da", false], ["b", "db", false], ["c", "dc", false]], { result: "unfinished" }),
  game([["a", "da", true], ["b", "db", false], ["c", "dc", false]], { status: "pending" }),
  game([["a", "da", true], ["b", "db", false], ["c", "dc", false]], { additional_rules: ["planechase"], brackets: ["4"] }),
];

describe("stats", () => {
  it("counts only approved games that someone won", () => {
    expect(countedGames(games)).toHaveLength(4);
  });

  it("computes player games, wins and win rate and hides RANDOM by default", () => {
    const s = playerStats(games);
    const a = s.find((x) => x.player_id === "a")!;
    expect(a).toMatchObject({ games: 4, wins: 2, winRate: 0.5 });
    expect(s.find((x) => x.player_id === "RANDOM")).toBeUndefined();
    expect(playerStats(games, { ignoredPlayers: [] }).find((x) => x.player_id === "RANDOM")?.games).toBe(1);
  });

  it("applies pod size, bracket and ignored-rule filters", () => {
    expect(countedGames(games, { podSizes: [4] })).toHaveLength(1);
    expect(countedGames(games, { brackets: ["4"] })).toHaveLength(1);
    expect(countedGames(games, { ignoredRules: ["planechase"] })).toHaveLength(3);
  });

  it("tracks per-deck records and last played", () => {
    const db = deckStats(games).find((d) => d.deck_id === "db")!;
    expect(db).toMatchObject({ games: 4, wins: 1, lastPlayed: "2026-02-01" });
  });

  it("splits seat win rates by pod size", () => {
    const three = seatStats(games).find((t) => t.podSize === 3)!;
    expect(three.games).toBe(3);
    expect(three.seats[0]).toMatchObject({ seat: 1, played: 3, wins: 2 });
    expect(three.seats[2].pctWon).toBeCloseTo(1 / 3);
    const a = playerSeatStats(games, "a").find((t) => t.podSize === 3)!;
    expect(a.seats[0]).toMatchObject({ played: 3, wins: 2, pctPlayed: 1, pctWon: 1 });
  });
});
