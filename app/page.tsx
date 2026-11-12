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

  const total = mine?.games ?? 0;
  // Percentages to one decimal; the difference is taken from the shown values so it adds up.
  const winPct = Math.round((mine?.winRate ?? 0) * 1000) / 10;
  const expPct = Math.round((mine?.expected ?? 0) * 1000) / 10;
  const diff = Math.round((winPct - expPct) * 10) / 10;
  return (
    <div className="stack">
      <div className="hello">
        <h1>Hi, {me.display_name}</h1>
      </div>

      <section className="record" aria-label="Your win rate">
        <div className="record-num">{total > 0 ? `${winPct.toFixed(1)}%` : "–"}</div>
        <div className="record-label">Your win rate</div>
        <div className="record-sub">
          {total > 0 ? (
            <>
              {mine!.wins} of {total} game{total === 1 ? "" : "s"} won
              <span className="record-expected">
                Expected {expPct.toFixed(1)}%
                <span className="record-diff">
                  {diff > 0 ? "+" : diff < 0 ? "−" : "±"}
                  {Math.abs(diff).toFixed(1)} pts vs expected
                </span>
              </span>
              <Link href={`/stats?view=seats&player=${me.player_id}`}>Your seat stats</Link>
            </>
          ) : (
            "No counted games yet."
          )}
        </div>
      </section>

      <div className="facts">
        <Link className="fact" href="/stats">
          <div className="fact-num">{sum.counted}</div>
          <div className="fact-label">games counted</div>
        </Link>
        <div className="fact">
          <div className="fact-num">{sum.draws + sum.unfinished}</div>
          <div className="fact-label">
            draws or unfinished, not counted
          </div>
        </div>
        {isAdmin(me) && (
          <Link className={`fact${sum.pending > 0 || unresolved > 0 ? " attention" : ""}`} href="/queue">
            <div className="fact-num">{sum.pending}</div>
            <div className="fact-label">
              waiting for approval{unresolved > 0 && `, ${unresolved} deck${unresolved === 1 ? "" : "s"} to link`}
            </div>
          </Link>
        )}
      </div>

      {myOpen.length > 0 && (
        <>
          <h2>Your games awaiting approval</h2>
          <div className="game-grid">
            {myOpen.map((g) => (
              <GameCard key={g.game_id} game={g} names={names} />
            ))}
          </div>
        </>
      )}

      <h2>Recent games</h2>
      {recent.length === 0 ? (
        <div className="empty">
          <strong>No games yet</strong>
          Finished a game? Log it while everyone&apos;s still at the table.
          <div>
            <Link className="btn primary" href="/games/new">
              Log a game
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="game-grid">
            {recent.map((g) => (
              <GameCard key={g.game_id} game={g} names={names} showStatus={false} />
            ))}
          </div>
          <Link className="more-link" href="/games">
            See all games
          </Link>
        </>
      )}
    </div>
  );
}
