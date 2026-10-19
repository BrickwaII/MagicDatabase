import type { Names } from "@/components/GameCard";
import { listDecks, listPlayers, listRules, listWinConditions } from "./data";

export async function loadNames(): Promise<Names> {
  const [players, decks, wcs, rules] = await Promise.all([
    listPlayers({ includeInactive: true }),
    listDecks({ includeInactive: true }),
    listWinConditions(),
    listRules(),
  ]);
  return {
    players: new Map(players.map((p) => [p.player_id, p])),
    decks: new Map(decks.map((d) => [d.deck_id, d])),
    winConditions: new Map(wcs.map((w) => [w.id, w])),
    rules: new Map(rules.map((r) => [r.id, r])),
  };
}
