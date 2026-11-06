import Link from "next/link";
import { GUEST_PLAYER_ID, type Deck, type GameWithSeats, type Lookup, type Player } from "@/lib/schema";
import { CrownIcon } from "./Icons";
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

const STATUS_LABEL: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

export function GameCard({ game, names, showStatus = true }: { game: GameWithSeats; names: Names; showStatus?: boolean }) {
  const resultLabel = game.result === "draw" ? "Draw" : game.result === "unfinished" ? "Unfinished" : null;
  const tags = [
    ...(game.brackets.length ? [`Bracket ${game.brackets.join(", ")}`] : []),
    ...game.win_conditions.map((w) => names.winConditions.get(w)?.name ?? w),
    ...game.additional_rules.map((r) => names.rules.get(r)?.name ?? r),
  ];
  return (
    <article className="card game" id={game.game_id}>
      <Link href={`/games/${game.game_id}`} className="game-head">
        <span className="game-date">{formatDate(game.date)}</span>
        <span className="game-no">Game {game.day_game_no}</span>
        <span className="game-badges">
          {resultLabel && <span className="badge">{resultLabel}</span>}
          {showStatus && <span className={`badge ${game.status}`}>{STATUS_LABEL[game.status] ?? game.status}</span>}
        </span>
      </Link>
      <ol className="seats">
        {game.seats.map((s) => {
          const deck = s.deck_id ? names.decks.get(s.deck_id) : undefined;
          return (
            <li key={s.seat} className={`seat${s.is_winner ? " win" : ""}`}>
              <span className="n" aria-label={`Seat ${s.seat}`}>
                {s.seat}
              </span>
              <span className="seat-player">{playerName(names, s.player_id)}</span>
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
      {tags.length > 0 && (
        <ul className="tags" aria-label="Details">
          {tags.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      {game.notes && <p className="game-notes">{game.notes}</p>}
      {game.status === "rejected" && game.reject_reason && <div className="small error">Rejected: {game.reject_reason}</div>}
    </article>
  );
}
