import { notFound, redirect } from "next/navigation";
import { DeckForm } from "@/components/DeckForm";
import { requirePlayer } from "@/lib/auth";
import { getDeck, listDeckCommanders, listPlayers } from "@/lib/data";
import { canEditDeck, isAdmin } from "@/lib/permissions";

export default async function EditDeck({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePlayer();
  const { id } = await params;
  const deck = await getDeck(id);
  if (!deck) notFound();
  if (!canEditDeck(me, deck)) redirect("/decks");
  const [players, commanders] = await Promise.all([listPlayers(), listDeckCommanders(id)]);
  return (
    <div className="stack form-page">
      <h1>Edit {deck.name}</h1>
      <DeckForm players={players} meId={me.player_id} admin={isAdmin(me)} deckId={id} initial={{ ...deck, commanders }} />
    </div>
  );
}
