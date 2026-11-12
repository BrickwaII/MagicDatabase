import Link from "next/link";
import { DeckListLink } from "@/components/GameCard";
import { Pips } from "@/components/Pips";
import { requirePlayer } from "@/lib/auth";
import { listDeckCommanders, listDecks, listGames, listPlayers } from "@/lib/data";
import { canEditDeck } from "@/lib/permissions";
import { deckStats } from "@/lib/stats";

export default async function Decks({ searchParams }: { searchParams: Promise<{ owner?: string; retired?: string }> }) {
  const me = await requirePlayer();
  const sp = await searchParams;
  const owner = sp.owner ?? me.player_id;
  const [players, decks, cmds, games] = await Promise.all([
    listPlayers(),
    listDecks({ owner: owner === "all" ? undefined : owner, includeInactive: !!sp.retired }),
    listDeckCommanders(),
    listGames({ status: "approved" }),
  ]);
  const cmdsByDeck = new Map<string, string[]>();
  for (const c of cmds) {
    if (c.role === "companion") continue;
    cmdsByDeck.set(c.deck_id, [...(cmdsByDeck.get(c.deck_id) ?? []), c.card_name || c.typed_name]);
  }
  // Deck record across all pilots.
  const totals = new Map<string, { games: number; wins: number }>();
  for (const s of deckStats(games, { ignoredPlayers: [] })) {
    const t = totals.get(s.deck_id) ?? { games: 0, wins: 0 };
    totals.set(s.deck_id, { games: t.games + s.games, wins: t.wins + s.wins });
  }
  const name = (id: string) => players.find((p) => p.player_id === id)?.display_name ?? id;

  const viewingAll = owner === "all";
  const emptyTitle = viewingAll ? "No decks yet" : owner === me.player_id ? "You have no decks yet" : `${name(owner)} has no decks yet`;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Decks</h1>
        <Link className="btn primary" href="/decks/new">
          + Add deck
        </Link>
      </div>
      <form className="deck-filter" method="get">
        <select name="owner" defaultValue={owner} aria-label="Whose decks">
          <option value="all">Everyone</option>
          {players.map((p) => (
            <option key={p.player_id} value={p.player_id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <label className="check small">
          <input type="checkbox" name="retired" value="1" defaultChecked={!!sp.retired} /> Show retired
        </label>
        <button type="submit">Show</button>
      </form>
      {decks.length === 0 ? (
        <div className="empty">
          <strong>{emptyTitle}</strong>
          Add a deck once and it&apos;s ready to pick every time you log a game.
          <div>
            <Link className="btn primary" href="/decks/new">
              Add a deck
            </Link>
          </div>
        </div>
      ) : (
        <ul className="deck-list">
          {decks.map((d) => {
            const t = totals.get(d.deck_id);
            const cmd = (cmdsByDeck.get(d.deck_id) ?? []).join(" + ");
            return (
              <li key={d.deck_id} className={`card deck${d.active ? "" : " retired"}`}>
                <Link className="deck-name" href={`/decks/${d.deck_id}`}>
                  <Pips colors={d.colors} /> <span>{d.name}</span>
                </Link>
                {canEditDeck(me, d) && (
                  <Link className="btn deck-edit" href={`/decks/${d.deck_id}?edit=1`} aria-label={`Edit ${d.name}`}>
                    Edit
                  </Link>
                )}
                <div className="deck-cmd">
                  {cmd || "No commander set"}
                  {d.commander_status === "unresolved" && (
                    <>
                      {" "}
                      <span className="badge pending">Not linked</span>
                    </>
                  )}
                </div>
                <div className="deck-meta">
                  {viewingAll && <span>{name(d.owner_player_id)}</span>}
                  <span>
                    <b>{t?.games ?? 0}</b> game{t?.games === 1 ? "" : "s"}
                  </span>
                  <span>
                    <b>{t?.games ? `${Math.round((t.wins / t.games) * 100)}%` : "–"}</b> win rate
                  </span>
                  {d.bracket && <span>Bracket {d.bracket}</span>}
                  {!d.active && <span>Retired</span>}
                  {d.list_url && <DeckListLink url={d.list_url} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
