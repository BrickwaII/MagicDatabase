// Public, read-only stats for one group, opened with its share token.
// No sign-in needed (see middleware.ts). Everything shown comes from
// getPublicStatsByToken, which reads only that group's approved games.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicRecentGames } from "@/components/PublicRecentGames";
import { StatsView, type SP, type StatsNames } from "@/components/StatsView";
import { getPublicStatsByToken } from "@/lib/share";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Commander stats",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SP>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const data = await getPublicStatsByToken(token);
  if (!data) notFound();

  const names: StatsNames = {
    players: new Map(data.players.map((p) => [p.player_id, p])),
    decks: new Map(data.decks.map((d) => [d.deck_id, d])),
  };
  const basePath = `/s/${encodeURIComponent(token)}`;

  return (
    <div className="stack">
      <StatsView
        sp={sp}
        basePath={basePath}
        games={data.games}
        players={data.players}
        rules={data.rules}
        names={names}
        versions={data.versions}
        publicView
        heading={
          <div className="spread">
            <div>
              <h1 style={{ marginBottom: 0 }}>{data.group.name}</h1>
              <span className="small muted">Commander stats · read-only</span>
            </div>
            <Link href="/login" className="small">
              Played with this group? Sign in
            </Link>
          </div>
        }
      />
      <h2>Recent games</h2>
      <PublicRecentGames games={data.games.slice(0, 20)} names={names} />
    </div>
  );
}
