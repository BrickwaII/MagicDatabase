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

/** A deck's list link, opened in a new tab. */
export function DeckListLink({ url }: { url: string }) {
  return (
    <a className="list-link" href={url} target="_blank" rel="noopener noreferrer">
      Deck list ↗
    </a>
  );
}

const STATUS_LABEL: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

export function GameCard({
  game,
  names,
  showStatus = true,
  detail = false,
}: {
  game: GameWithSeats;
  names: Names;
  showStatus?: boolean;
  /** Game detail page: also show who brought each guest and deck list links. */
  detail?: boolean;
}) {
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
          const guest = s.player_id === GUEST_PLAYER_ID;
          const host = detail && guest && s.guest_added_by ? playerName(names, s.guest_added_by) : "";
          const listUrl = detail && deck?.list_url ? deck.list_url : "";
          return (
            <li key={s.seat} className={`seat${s.is_winner ? " win" : ""}`}>
              <span className="n" aria-label={`Seat ${s.seat}`}>
                {s.seat}
              </span>
              <span className={`seat-player${guest ? " guest" : ""}`}>
                {guest ? (
                  <>
                    Guest{s.guest_name && <span className="seat-guest-name"> · {s.guest_name}</span>}
                  </>
                ) : (
                  playerName(names, s.player_id)
                )}
              </span>
              <span className="seat-deck">
                {deck ? (
                  <>
                    <Pips colors={deck.colors} /> <span className="seat-deck-name">{deck.name}</span>
                  </>
                ) : (
                  guest &&
                  s.guest_deck && (
                    <span className="seat-deck-name untracked" title="Guest's deck (not tracked)">
                      {s.guest_deck}
                    </span>
                  )
                )}
              </span>
              {s.is_winner && (
                <span className="seat-won">
                  <CrownIcon /> <span className="sr-only">Winner</span>
                </span>
              )}
              {(host || listUrl) && (
                <span className="seat-extra">
                  {host && <span>Brought by {host}</span>}
                  {listUrl && <DeckListLink url={listUrl} />}
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
