import Link from "next/link";
import { approveGameAction, rejectGameAction } from "@/app/actions";
import { GameCard } from "@/components/GameCard";
import { Pips } from "@/components/Pips";
import { requireAdmin } from "@/lib/auth";
import { listDecks, listGames } from "@/lib/data";
import { loadNames } from "@/lib/names";

export default async function Queue({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { error } = await searchParams;
  const [pending, decks, names] = await Promise.all([listGames({ status: "pending" }), listDecks(), loadNames()]);
  const unresolved = decks.filter((d) => d.commander_status === "unresolved");
  // Oldest first, so the queue is worked in order.
  pending.reverse();
  return (
    <div className="stack">
      <h1>Approval queue</h1>
      {error && <div className="error">{error}</div>}
      {pending.length === 0 ? (
        <p className="muted">Nothing waiting. 🎉</p>
      ) : (
        pending.map((g) => (
          <div key={g.game_id} className="stack">
            <GameCard game={g} names={names} />
            <div className="row">
              <span className="small muted">
                from {names.players.get(g.submitted_by)?.display_name ?? g.submitted_by}
                {g.rev > 1 && " · edited"}
              </span>
              <form action={approveGameAction}>
                <input type="hidden" name="id" value={g.game_id} />
                <button className="primary">Approve</button>
              </form>
              <form action={rejectGameAction} className="row" style={{ flex: 1 }}>
                <input type="hidden" name="id" value={g.game_id} />
                <input name="reason" placeholder="Reason" required style={{ flex: 1, minWidth: 140 }} />
                <button className="danger">Reject</button>
              </form>
            </div>
          </div>
        ))
      )}

      <h2>Decks to link to a real commander</h2>
      {unresolved.length === 0 ? (
        <p className="muted">All decks are linked to Scryfall cards.</p>
      ) : (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Deck</th>
                <th>Owner</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {unresolved.map((d) => (
                <tr key={d.deck_id}>
                  <td>
                    <Pips colors={d.colors} /> {d.name}
                  </td>
                  <td>{names.players.get(d.owner_player_id)?.display_name}</td>
                  <td>
                    <Link href={`/decks/${d.deck_id}`}>Link commander →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
