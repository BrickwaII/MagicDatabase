import Link from "next/link";
import { approveGameAction, rejectGameAction } from "@/app/actions";
import { GameCard } from "@/components/GameCard";
import { Pips } from "@/components/Pips";
import { SubmitButton } from "@/components/SubmitButton";
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
      <div className="page-head">
        <h1>Approval queue</h1>
      </div>
      <p className="lede">Oldest first. Approved games count in stats right away.</p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {pending.length === 0 ? (
        <div className="empty">
          <strong>You&apos;re all caught up</strong>
          New games from players will wait here until you approve them.
        </div>
      ) : (
        pending.map((g) => (
          <div key={g.game_id} className="queue-item">
            <GameCard game={g} names={names} />
            <p className="small muted" style={{ margin: 0 }}>
              Logged by {names.players.get(g.submitted_by)?.display_name ?? g.submitted_by}
              {g.rev > 1 && ", since edited"}
            </p>
            <div className="queue-actions">
              <form action={approveGameAction}>
                <input type="hidden" name="id" value={g.game_id} />
                <input type="hidden" name="rev" value={g.rev} />
                <SubmitButton className="primary" pendingText="Approving…">
                  Approve
                </SubmitButton>
              </form>
              <form action={rejectGameAction} className="reject">
                <input type="hidden" name="id" value={g.game_id} />
                <input type="hidden" name="rev" value={g.rev} />
                <input name="reason" placeholder="Reason for rejecting" aria-label="Reason for rejecting" required />
                <SubmitButton className="danger" pendingText="Rejecting…">
                  Reject
                </SubmitButton>
              </form>
            </div>
          </div>
        ))
      )}

      <h2>Decks to link to a real commander</h2>
      {unresolved.length === 0 ? (
        <p className="muted">Every deck is linked to a Scryfall card.</p>
      ) : (
        <ul className="deck-list">
          {unresolved.map((d) => (
            <li key={d.deck_id} className="card deck">
              <div className="deck-name">
                <Pips colors={d.colors} /> <span>{d.name}</span>
              </div>
              <div className="deck-cmd">{names.players.get(d.owner_player_id)?.display_name}</div>
              <Link className="btn deck-edit" href={`/decks/${d.deck_id}`}>
                Link commander
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
