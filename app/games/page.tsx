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
  return (
    <div className="stack">
      <div className="spread">
        <h1>Games</h1>
        <Link className="btn primary" href="/games/new">
          + Log a game
        </Link>
      </div>
      <form className="card row" method="get">
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
        <button type="submit">Filter</button>
        <Link href="/games" className="small">
          Clear
        </Link>
      </form>
      <p className="muted small">
        {games.length} game{games.length === 1 ? "" : "s"}
        {games.length > shown.length && `, showing the latest ${shown.length}`}
      </p>
      <div className="stack">
        {shown.map((g) => (
          <GameCard key={g.game_id} game={g} names={names} />
        ))}
      </div>
    </div>
  );
}
