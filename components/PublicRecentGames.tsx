// Read-only game list for the public share page: date, seats with decks,
// winner. Same layout as GameCard, but no links, status, notes, tags or
// guest details (guests show as "Guest" only).
import { formatDate } from "@/components/GameCard";
import { CrownIcon } from "@/components/Icons";
import { Pips } from "@/components/Pips";
import { GUEST_PLAYER_ID, type GameWithSeats } from "@/lib/schema";
import type { StatsNames } from "./StatsView";

export function PublicRecentGames({ games, names }: { games: GameWithSeats[]; names: StatsNames }) {
  if (games.length === 0) return <p className="muted">No games yet.</p>;
  const name = (id: string) => (id === GUEST_PLAYER_ID ? "Guest" : (names.players.get(id)?.display_name ?? id));
  return (
    <div className="stack">
      {games.map((g) => {
        const result = g.result === "draw" ? "Draw" : g.result === "unfinished" ? "Unfinished" : null;
        return (
          <article key={g.game_id} className="card game">
            <div className="game-head static">
              <span className="game-date">{formatDate(g.date)}</span>
              <span className="game-no">Game {g.day_game_no}</span>
              <span className="game-badges">{result && <span className="badge">{result}</span>}</span>
            </div>
            <ol className="seats">
              {g.seats.map((s) => {
                const deck = s.deck_id ? names.decks.get(s.deck_id) : undefined;
                const guest = s.player_id === GUEST_PLAYER_ID;
                return (
                  <li key={s.seat} className={`seat${s.is_winner ? " win" : ""}`}>
                    <span className="n" aria-label={`Seat ${s.seat}`}>
                      {s.seat}
                    </span>
                    <span className={`seat-player${guest ? " guest" : ""}`}>{name(s.player_id)}</span>
                    <span className="seat-deck">
                      {deck && (
                        <>
                          <Pips colors={deck.colors} /> <span className="seat-deck-name">{deck.name}</span>
                        </>
                      )}
                    </span>
                    {s.is_winner && (
                      <span className="seat-won">
                        <CrownIcon /> <span className="sr-only">Winner</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </article>
        );
      })}
    </div>
  );
}
