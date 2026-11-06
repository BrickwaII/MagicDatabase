import { GameForm } from "@/components/GameForm";
import { requirePlayer } from "@/lib/auth";
import { listDecks, listPlayers, listRules, listWinConditions } from "@/lib/data";
import { isAdmin } from "@/lib/permissions";

export default async function NewGame() {
  const me = await requirePlayer();
  const [players, decks, winConditions, rules] = await Promise.all([
    listPlayers(),
    listDecks(),
    listWinConditions(),
    listRules(),
  ]);
  return (
    <div className="stack form-page">
      <h1>Log a game</h1>
      <GameForm
        players={players}
        decks={decks}
        winConditions={winConditions}
        rules={rules}
        meId={me.player_id}
        saveNote={isAdmin(me) ? undefined : "Games count in stats once Henry approves them."}
      />
    </div>
  );
}
