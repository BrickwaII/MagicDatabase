import Link from "next/link";
import { GameCard } from "@/components/GameCard";
import { requirePlayer } from "@/lib/auth";
import { listGamesPage, listPlayers } from "@/lib/data";
import { loadNames } from "@/lib/names";
import type { GameStatus } from "@/lib/schema";

type SP = { from?: string; to?: string; date?: string; player?: string; status?: string; shown?: string };

/** Games per "Show more". */
const PAGE = 20;
/** Upper bound on ?shown= so a hand-edited URL can't load everything at once. */
const MAX_SHOWN = 5000;

export default async function Games({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePlayer();
  const sp = await searchParams;
  const from = sp.date || sp.from || undefined;
  const to = sp.date || sp.to || undefined;
  const status = (["pending", "approved", "rejected"] as const).includes(sp.status as GameStatus)
    ? (sp.status as GameStatus)
    : undefined;
  // How many to show: ?shown=N, rounded up to whole pages of 20.
  const asked = Number.parseInt(sp.shown ?? "", 10);
  const limit = Math.min(MAX_SHOWN, Math.max(PAGE, Number.isFinite(asked) ? Math.ceil(asked / PAGE) * PAGE : PAGE));
  const [{ games: shown, total, nextId }, players, names] = await Promise.all([
    listGamesPage({ from, to, playerId: sp.player || undefined, status }, limit),
    listPlayers(),
    loadNames(),
  ]);
  // "Show more" keeps the filters and scrolls to the first newly shown game.
  const more = new URLSearchParams();
  for (const k of ["from", "to", "date", "player", "status"] as const) if (sp[k]) more.set(k, sp[k]!);
  more.set("shown", String(limit + PAGE));
  const moreHref = `/games?${more}${nextId ? `#${encodeURIComponent(nextId)}` : ""}`;
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
            {total} game{total === 1 ? "" : "s"}
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
        <>
          <div className="game-grid">
            {shown.map((g) => (
              <GameCard key={g.game_id} game={g} names={names} />
            ))}
          </div>
          <div className="show-more">
            <p className="muted small" aria-live="polite">
              Showing {shown.length} of {total} game{total === 1 ? "" : "s"}
            </p>
            {shown.length < total && (
              <Link className="btn" href={moreHref}>
                Show {Math.min(PAGE, total - shown.length)} more
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
