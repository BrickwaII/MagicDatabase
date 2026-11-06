import { StatsView, type SP } from "@/components/StatsView";
import { requirePlayer } from "@/lib/auth";
import { listGames, listPlayers, listRules } from "@/lib/data";
import { loadNames } from "@/lib/names";

export default async function Stats({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePlayer();
  const sp = await searchParams;
  const [games, players, rules, names] = await Promise.all([listGames(), listPlayers(), listRules(), loadNames()]);
  return <StatsView sp={sp} basePath="/stats" games={games} players={players} rules={rules} names={names} />;
}
