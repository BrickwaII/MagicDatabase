import { DeckForm } from "@/components/DeckForm";
import { requirePlayer } from "@/lib/auth";
import { listPlayers } from "@/lib/data";
import { isAdmin } from "@/lib/permissions";

export default async function NewDeck() {
  const me = await requirePlayer();
  const players = await listPlayers();
  return (
    <div className="stack">
      <h1>Add a deck</h1>
      <DeckForm players={players} meId={me.player_id} admin={isAdmin(me)} />
    </div>
  );
}
