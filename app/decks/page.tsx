import Link from "next/link";
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

  return (
    <div className="stack">
      <div className="spread">
        <h1>Decks</h1>
        <Link className="btn primary" href="/decks/new">
          + Add deck
        </Link>
      </div>
      <form className="row" method="get">
        <select name="owner" defaultValue={owner}>
          <option value="all">Everyone</option>
          {players.map((p) => (
            <option key={p.player_id} value={p.player_id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <label className="row small">
          <input type="checkbox" name="retired" value="1" defaultChecked={!!sp.retired} /> Show retired
        </label>
        <button type="submit">Show</button>
      </form>
      <div className="table-wrap card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Deck</th>
              {owner === "all" && <th>Owner</th>}
              <th>Commander</th>
              <th className="num">Bracket</th>
              <th className="num">Games</th>
              <th className="num">Win %</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {decks.map((d) => {
              const t = totals.get(d.deck_id);
              return (
                <tr key={d.deck_id} style={{ opacity: d.active ? 1 : 0.55 }}>
                  <td>
                    <Pips colors={d.colors} /> <strong>{d.name}</strong>
                  </td>
                  {owner === "all" && <td>{name(d.owner_player_id)}</td>}
                  <td>
                    {(cmdsByDeck.get(d.deck_id) ?? []).join(" + ") || <span className="muted">—</span>}
                    {d.commander_status === "unresolved" && <span className="badge pending"> unlinked</span>}
                  </td>
                  <td className="num">{d.bracket || "—"}</td>
                  <td className="num">{t?.games ?? 0}</td>
                  <td className="num">{t?.games ? `${Math.round((t.wins / t.games) * 100)}%` : "—"}</td>
                  <td>{canEditDeck(me, d) && <Link href={`/decks/${d.deck_id}`}>Edit</Link>}</td>
                </tr>
              );
            })}
            {decks.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No decks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
