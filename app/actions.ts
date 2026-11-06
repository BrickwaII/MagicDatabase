"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requirePlayer } from "@/lib/auth";
import {
  AppError,
  approveGame,
  createDeck,
  createGame,
  deleteGame,
  rejectGame,
  updateDeck,
  updateGame,
  upsertLookup,
  upsertPlayer,
  type DeckInput,
  type GameInput,
} from "@/lib/data";

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };

async function attempt(fn: () => Promise<string>): Promise<ActionResult> {
  try {
    return { ok: true, id: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong saving that. Try again in a moment." };
  }
}

export async function saveGame(payload: { id?: string; rev?: number; input: GameInput }): Promise<ActionResult> {
  const actor = await requirePlayer();
  const res = await attempt(async () =>
    payload.id
      ? (await updateGame(payload.id, payload.input, payload.rev ?? 0, actor)).game_id
      : (await createGame(payload.input, actor)).game_id,
  );
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/** The rev the admin saw when the page was rendered (hidden "rev" field), if sent. */
function formRev(formData: FormData): number | undefined {
  const raw = formData.get("rev");
  const n = Number(raw);
  return raw !== null && raw !== "" && Number.isInteger(n) ? n : undefined;
}

export async function approveGameAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = String(formData.get("id"));
  try {
    await approveGame(id, actor, formRev(formData));
  } catch (e) {
    if (e instanceof AppError) redirect(`/queue?error=${encodeURIComponent(e.message)}#${id}`);
    throw e;
  }
  revalidatePath("/", "layout");
}

export async function rejectGameAction(formData: FormData) {
  const actor = await requireAdmin();
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "");
  try {
    await rejectGame(id, actor, reason, formRev(formData));
  } catch (e) {
    if (e instanceof AppError) redirect(`/queue?error=${encodeURIComponent(e.message)}#${id}`);
    throw e;
  }
  revalidatePath("/", "layout");
}

export async function deleteGameAction(formData: FormData) {
  const actor = await requireAdmin();
  await deleteGame(String(formData.get("id")), actor);
  revalidatePath("/", "layout");
  redirect("/games");
}

export async function saveDeck(payload: { id?: string; active?: boolean; input: DeckInput }): Promise<ActionResult> {
  const actor = await requirePlayer();
  const res = await attempt(async () =>
    payload.id
      ? (await updateDeck(payload.id, { ...payload.input, active: payload.active }, actor)).deck_id
      : (await createDeck(payload.input, actor)).deck_id,
  );
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

function back(path: string, error?: string): never {
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

export async function savePlayerAction(formData: FormData) {
  const actor = await requireAdmin();
  let error: string | undefined;
  try {
    await upsertPlayer(
      {
        player_id: String(formData.get("player_id") ?? "") || undefined,
        display_name: String(formData.get("display_name") ?? ""),
        email: String(formData.get("email") ?? ""),
        role: formData.get("role") === "admin" ? "admin" : "player",
        active: formData.get("active") === "on",
      },
      actor,
    );
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  revalidatePath("/", "layout");
  back("/admin", error);
}

export async function saveLookupAction(formData: FormData) {
  const actor = await requireAdmin();
  const tab = formData.get("tab") === "Rules" ? "Rules" : "WinConditions";
  let error: string | undefined;
  try {
    await upsertLookup(
      tab,
      { id: String(formData.get("id") ?? "") || undefined, name: String(formData.get("name") ?? "") },
      actor,
    );
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  revalidatePath("/", "layout");
  back("/admin", error);
}
