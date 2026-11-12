// Read-only game list for the public share page: date, seats with decks,
// winner. No links, notes or review details.
import { formatDate } from "@/components/GameCard";
import { Pips } from "@/components/Pips";
import { GUEST_PLAYER_ID, type GameWithSeats } from "@/lib/schema";
import type { StatsNames } from "./StatsView";

export function PublicRecentGames({ games, names }: { games: GameWithSeats[]; names: StatsNames }) {
  if (games.length === 0) return <p className="muted">No games yet.</p>;
  const name = (id: string) => (id === GUEST_PLAYER_ID ? "Guest" : (names.players.get(id)?.display_name ?? id));
  return (
    <div className="stack">
      {games.map((g) => {
        const winners = g.seats.filter((s) => s.is_winner).map((s) => name(s.player_id));
        const result = g.result === "draw" ? "Draw" : g.result === "unfinished" ? "Unfinished" : null;
        return (
          <div key={g.game_id} className="card game">
            <div className="spread">
              <span>
                <strong>{formatDate(g.date)}</strong> · Game {g.day_game_no}
              </span>
              <span className="row">
                {result ? <span className="badge">{result}</span> : winners.length > 0 && <span className="small">Winner: {winners.join(", ")}</span>}
              </span>
            </div>
            <div className="seats">
              {g.seats.map((s) => {
                const deck = s.deck_id ? names.decks.get(s.deck_id) : undefined;
                return (
                  <div key={s.seat} className={`seat${s.is_winner ? " win" : ""}`}>
                    <span className="n">{s.seat}</span>
                    <span>
                      {name(s.player_id)}
                      {deck && (
                        <span className="muted">
                          {" "}
                          · <Pips colors={deck.colors} /> {deck.name}
                        </span>
                      )}
                      {s.is_winner && <span className="crown"> ♛</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
