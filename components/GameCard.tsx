import Link from "next/link";
import { GUEST_PLAYER_ID, type Deck, type GameWithSeats, type Lookup, type Player } from "@/lib/schema";
import { Pips } from "./Pips";

export interface Names {
  players: Map<string, Player>;
  decks: Map<string, Deck>;
  winConditions: Map<string, Lookup>;
  rules: Map<string, Lookup>;
}

export function formatDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function playerName(names: Names, id: string) {
  return id === GUEST_PLAYER_ID ? "Guest" : (names.players.get(id)?.display_name ?? id);
}

export function GameCard({ game, names, showStatus = true }: { game: GameWithSeats; names: Names; showStatus?: boolean }) {
  const resultLabel = game.result === "draw" ? "Draw" : game.result === "unfinished" ? "Unfinished" : null;
  return (
    <div className="card game" id={game.game_id}>
      <div className="spread">
        <Link href={`/games/${game.game_id}`}>
          <strong>{formatDate(game.date)}</strong> · Game {game.day_game_no}
        </Link>
        <span className="row">
          {resultLabel && <span className="badge">{resultLabel}</span>}
          {showStatus && <span className={`badge ${game.status}`}>{game.status}</span>}
        </span>
      </div>
      <div className="seats">
        {game.seats.map((s) => {
          const deck = s.deck_id ? names.decks.get(s.deck_id) : undefined;
          return (
            <div key={s.seat} className={`seat${s.is_winner ? " win" : ""}`}>
              <span className="n">{s.seat}</span>
              <span>
                {playerName(names, s.player_id)}
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
      <div className="small muted">
        {[
          game.brackets.length ? `Bracket ${game.brackets.join(", ")}` : "",
          game.win_conditions.map((w) => names.winConditions.get(w)?.name ?? w).join(", "),
          game.additional_rules.map((r) => names.rules.get(r)?.name ?? r).join(", "),
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {game.notes && <div className="small">{game.notes}</div>}
      {game.status === "rejected" && game.reject_reason && (
        <div className="small error">Rejected: {game.reject_reason}</div>
      )}
    </div>
  );
}
