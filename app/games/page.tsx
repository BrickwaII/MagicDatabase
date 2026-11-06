import Link from "next/link";
import { GameCard } from "@/components/GameCard";
import { requirePlayer } from "@/lib/auth";
import { listGames, listPlayers } from "@/lib/data";
import { loadNames } from "@/lib/names";
import type { GameStatus } from "@/lib/schema";

type SP = { from?: string; to?: string; date?: string; player?: string; status?: string };

export default async function Games({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePlayer();
  const sp = await searchParams;
  const from = sp.date || sp.from || undefined;
  const to = sp.date || sp.to || undefined;
  const status = (["pending", "approved", "rejected"] as const).includes(sp.status as GameStatus)
    ? (sp.status as GameStatus)
    : undefined;
  const [games, players, names] = await Promise.all([
    listGames({ from, to, playerId: sp.player || undefined, status }),
    listPlayers(),
    loadNames(),
  ]);
  const shown = games.slice(0, 200);
  const filtered = !!(sp.from || sp.to || sp.date || sp.player || sp.status);
  const activeCount = [sp.from || sp.date, sp.to, sp.player, sp.status].filter(Boolean).length;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Games</h1>
      </div>
      <details className="card" open={filtered}>
        <summary>
          Filter
          <span className="summary-hint">
            {games.length} game{games.length === 1 ? "" : "s"}
            {activeCount > 0 && `, ${activeCount} filter${activeCount === 1 ? "" : "s"} on`}
          </span>
        </summary>
        <form className="filters" method="get" style={{ marginTop: 14 }}>
          <label>
            <span className="lbl">From</span>
            <input type="date" name="from" defaultValue={sp.from} />
          </label>
          <label>
            <span className="lbl">To</span>
            <input type="date" name="to" defaultValue={sp.to} />
          </label>
          <label>
            <span className="lbl">Player</span>
            <select name="player" defaultValue={sp.player ?? ""}>
              <option value="">Anyone</option>
              {players.map((p) => (
                <option key={p.player_id} value={p.player_id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="lbl">Status</span>
            <select name="status" defaultValue={sp.status ?? ""}>
              <option value="">Any</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <div className="filter-actions">
            <button type="submit" className="primary">
              Apply
            </button>
            {filtered && (
              <Link href="/games" className="btn">
                Clear
              </Link>
            )}
          </div>
        </form>
      </details>
      {games.length > shown.length && <p className="muted small">Showing the latest {shown.length} of {games.length}.</p>}
      {shown.length === 0 ? (
        <div className="empty">
          <strong>{filtered ? "No games match these filters" : "No games yet"}</strong>
          {filtered ? "Try a wider date range or a different player." : "Log your first game and it will show up here."}
          <div>
            {filtered ? (
              <Link className="btn" href="/games">
                Clear filters
              </Link>
            ) : (
              <Link className="btn primary" href="/games/new">
                Log a game
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="game-grid">
          {shown.map((g) => (
            <GameCard key={g.game_id} game={g} names={names} />
          ))}
        </div>
      )}
    </div>
  );
}
