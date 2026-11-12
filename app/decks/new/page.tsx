import { DeckForm } from "@/components/DeckForm";
import { requirePlayer } from "@/lib/auth";
import { listPlayers } from "@/lib/data";
import { isAdmin } from "@/lib/permissions";
import { playerOptions } from "@/lib/schema";

export default async function NewDeck() {
  const me = await requirePlayer();
  const players = await listPlayers();
  return (
    <div className="stack form-page">
      <h1>Add a deck</h1>
      <DeckForm players={playerOptions(players)} meId={me.player_id} admin={isAdmin(me)} />
    </div>
  );
}
