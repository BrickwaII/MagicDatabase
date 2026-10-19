import type { Deck, GameWithSeats, Player } from "./schema";

export const isAdmin = (p: Player | null | undefined) => !!p && p.active && p.role === "admin";

export const wasInGame = (p: Player, g: Pick<GameWithSeats, "seats">) =>
  g.seats.some((s) => s.player_id === p.player_id);

/** Players can edit any game they sat in; admins can edit any game. */
export const canEditGame = (p: Player, g: GameWithSeats) => isAdmin(p) || wasInGame(p, g);

export const canApprove = isAdmin;

/** Players manage their own decks; admins manage anyone's. */
export const canEditDeck = (p: Player, d: Pick<Deck, "owner_player_id">) =>
  isAdmin(p) || d.owner_player_id === p.player_id;

export const canManagePlayers = isAdmin;
export const canManageLookups = isAdmin;
