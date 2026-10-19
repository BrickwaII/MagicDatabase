import { notFound } from "next/navigation";
import { approveGameAction, deleteGameAction, rejectGameAction } from "@/app/actions";
import { GameCard } from "@/components/GameCard";
import { GameForm } from "@/components/GameForm";
import { requirePlayer } from "@/lib/auth";
import { getGame, listDecks, listPlayers, listRules, listWinConditions } from "@/lib/data";
import { loadNames } from "@/lib/names";
import { canEditGame, isAdmin } from "@/lib/permissions";

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const me = await requirePlayer();
  const { id } = await params;
  const { edit } = await searchParams;
  const game = await getGame(id);
  if (!game) notFound();
  const names = await loadNames();
  const editable = canEditGame(me, game);
  const admin = isAdmin(me);

  if (edit && editable) {
    // Keep players/decks that have since been deactivated so old games still edit cleanly.
    const used = new Set(game.seats.flatMap((s) => [s.player_id, s.deck_id]));
    const [players, decks, winConditions, rules] = await Promise.all([
      listPlayers({ includeInactive: true }).then((ps) => ps.filter((p) => p.active || used.has(p.player_id))),
      listDecks({ includeInactive: true }).then((ds) => ds.filter((d) => d.active || used.has(d.deck_id))),
      listWinConditions(),
      listRules(),
    ]);
    return (
      <div className="stack">
        <h1>Edit game</h1>
        <GameForm
          players={players}
          decks={decks}
          winConditions={winConditions}
          rules={rules}
          meId={me.player_id}
          gameId={game.game_id}
          rev={game.rev}
          initial={game}
          saveNote={
            !admin && game.status !== "pending"
              ? "Saving sends this game back to the approval queue until Henry approves the change."
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="spread">
        <h1>Game</h1>
        {editable && (
          <a className="btn" href={`/games/${id}?edit=1`}>
            Edit
          </a>
        )}
      </div>
      <GameCard game={game} names={names} />
      <p className="small muted">
        Submitted by {names.players.get(game.submitted_by)?.display_name ?? game.submitted_by}
        {game.approved_by && <> · approved by {names.players.get(game.approved_by)?.display_name ?? game.approved_by}</>}
      </p>
      {admin && (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Admin</h3>
          <div className="row">
            {game.status !== "approved" && (
              <form action={approveGameAction}>
                <input type="hidden" name="id" value={id} />
                <button className="primary">Approve</button>
              </form>
            )}
            <form action={deleteGameAction}>
              <input type="hidden" name="id" value={id} />
              <button className="danger">Delete game</button>
            </form>
          </div>
          {game.status !== "rejected" && (
            <form action={rejectGameAction} className="row">
              <input type="hidden" name="id" value={id} />
              <input name="reason" placeholder="Reason for rejecting" required style={{ flex: 1 }} />
              <button className="danger">Reject</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
