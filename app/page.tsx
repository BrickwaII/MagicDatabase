import Link from "next/link";
import { GameCard } from "@/components/GameCard";
import { requirePlayer } from "@/lib/auth";
import { listDecks, listGames } from "@/lib/data";
import { loadNames } from "@/lib/names";
import { isAdmin } from "@/lib/permissions";
import { playerStats, summary } from "@/lib/stats";

export default async function Home() {
  const me = await requirePlayer();
  const [games, names, unresolved] = await Promise.all([
    listGames(),
    loadNames(),
    isAdmin(me) ? listDecks().then((d) => d.filter((x) => x.commander_status === "unresolved").length) : 0,
  ]);
  const mine = playerStats(games, { ignoredPlayers: [] }).find((s) => s.player_id === me.player_id);
  const sum = summary(games);
  const myOpen = games.filter(
    (g) => g.status !== "approved" && (g.submitted_by === me.player_id || g.seats.some((s) => s.player_id === me.player_id)),
  );
  const recent = games.filter((g) => g.status === "approved").slice(0, 8);

  return (
    <div className="stack">
      <div className="spread">
        <h1>Hi, {me.display_name}</h1>
        <Link className="btn primary" href="/games/new">
          + Log a game
        </Link>
      </div>
      <div className="grid">
        <div className="card">
          <div className="muted small">Your record</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            {mine ? `${mine.wins}–${mine.games - mine.wins}` : "0–0"}
          </div>
          <div className="small muted">{mine ? `${Math.round(mine.winRate * 100)}% win rate` : "No games yet"}</div>
        </div>
        <div className="card">
          <div className="muted small">Games counted</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{sum.counted}</div>
          <div className="small muted">
            {sum.draws} draws · {sum.unfinished} unfinished (not counted)
          </div>
        </div>
        {isAdmin(me) && (
          <div className="card">
            <div className="muted small">Waiting on you</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{sum.pending}</div>
            <div className="small">
              <Link href="/queue">Approval queue</Link>
              {unresolved > 0 && <> · {unresolved} decks to link</>}
            </div>
          </div>
        )}
      </div>

      {myOpen.length > 0 && (
        <>
          <h2>Your games awaiting approval</h2>
          <div className="stack">
            {myOpen.map((g) => (
              <GameCard key={g.game_id} game={g} names={names} />
            ))}
          </div>
        </>
      )}

      <h2>Recent games</h2>
      {recent.length === 0 ? (
        <p className="muted">No approved games yet.</p>
      ) : (
        <div className="stack">
          {recent.map((g) => (
            <GameCard key={g.game_id} game={g} names={names} showStatus={false} />
          ))}
        </div>
      )}
      <p>
        <Link href="/games">All games →</Link>
      </p>
    </div>
  );
}
