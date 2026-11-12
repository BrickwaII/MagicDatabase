// Deck versions: logged changes to a deck ("cut 6 removal, added Rhystic
// Study"), so its record can be compared before and after. Version 1 is
// implicit; each row starts version 2, 3, … on its started_on date. Which
// version a game used comes from the game's date (lib/stats.ts versionOn),
// never from the game form, so logging a game stays fast.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { AppError, audit, ctx, isoDate, listUrlSchema, newId } from "./data";
import type { Db, Tx } from "./db";
import { decks, deckVersions } from "./db/schema";
import { canEditDeck } from "./permissions";
import { VERSION_NOTE_MAX, type DeckVersion, type Player } from "./schema";

type Conn = Db | Tx;
type Row = typeof deckVersions.$inferSelect;

const toVersion = (r: Row): DeckVersion => ({
  id: r.id,
  deck_id: r.deckId,
  version_no: r.versionNo,
  started_on: r.startedOn,
  note: r.note,
  list_url: r.listUrl ?? "",
  created_by: r.createdBy,
  created_at: r.createdAt.toISOString(),
});

export const versionValues = (gid: string, v: DeckVersion): typeof deckVersions.$inferInsert => ({
  groupId: gid,
  id: v.id,
  deckId: v.deck_id,
  versionNo: v.version_no,
  startedOn: v.started_on,
  note: v.note,
  listUrl: v.list_url || null,
  createdBy: v.created_by,
  createdAt: new Date(v.created_at),
});

/** The group's logged versions (all decks, or one), oldest first per deck. */
export async function listDeckVersions(deckId?: string): Promise<DeckVersion[]> {
  const { db, gid } = await ctx();
  const where = deckId ? and(eq(deckVersions.groupId, gid), eq(deckVersions.deckId, deckId)) : eq(deckVersions.groupId, gid);
  return (await db.select().from(deckVersions).where(where).orderBy(asc(deckVersions.deckId), asc(deckVersions.versionNo))).map(toVersion);
}

export const versionInputSchema = z.object({
  started_on: isoDate,
  note: z.string().trim().min(1, "Say what changed").max(VERSION_NOTE_MAX, `Note: at most ${VERSION_NOTE_MAX} characters`),
  list_url: listUrlSchema,
});
export type VersionInput = z.input<typeof versionInputSchema>;

function parseInput(input: VersionInput) {
  const parsed = versionInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues.map((i) => i.message).join("; "));
  const v = parsed.data;
  const real = new Date(`${v.started_on}T00:00:00Z`);
  if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== v.started_on) throw new AppError("That date doesn't exist");
  return v;
}

/** Lock the deck and check the actor may change it (its owner, or an admin). */
async function lockDeck(tx: Conn, gid: string, deckId: string, actor: Player) {
  const [deck] = await tx
    .select()
    .from(decks)
    .where(and(eq(decks.groupId, gid), eq(decks.id, deckId)))
    .for("update");
  if (!deck) throw new AppError("Deck not found");
  if (!canEditDeck(actor, { owner_player_id: deck.ownerPlayerId })) throw new AppError("You can only log changes to your own decks");
  return deck;
}

async function deckRows(tx: Conn, gid: string, deckId: string) {
  return (
    await tx
      .select()
      .from(deckVersions)
      .where(and(eq(deckVersions.groupId, gid), eq(deckVersions.deckId, deckId)))
      .orderBy(asc(deckVersions.startedOn))
  ).map(toVersion);
}

/** Rewrite a deck's versions so version_no follows started_on (2, 3, …). */
async function writeNumbered(tx: Conn, gid: string, deckId: string, list: DeckVersion[]) {
  const sorted = [...list].sort((a, b) => a.started_on.localeCompare(b.started_on));
  const numbered = sorted.map((v, i) => ({ ...v, version_no: i + 2 }));
  await tx.delete(deckVersions).where(and(eq(deckVersions.groupId, gid), eq(deckVersions.deckId, deckId)));
  if (numbered.length) await tx.insert(deckVersions).values(numbered.map((v) => versionValues(gid, v)));
  return numbered;
}

function assertFreeDate(list: DeckVersion[], date: string, exceptId?: string) {
  if (list.some((v) => v.started_on === date && v.id !== exceptId)) {
    throw new AppError("A change is already logged on that date. Edit that one instead.");
  }
}

/** A new list link becomes the deck's current list link too (audited as a deck update). */
async function setDeckListUrl(tx: Conn, gid: string, deck: typeof decks.$inferSelect, url: string, actor: Player) {
  if (!url || url === deck.listUrl) return;
  await tx.update(decks).set({ listUrl: url }).where(and(eq(decks.groupId, gid), eq(decks.id, deck.id)));
  await audit(tx, gid, actor, "deck", deck.id, "update", { list_url: deck.listUrl ?? "" }, { list_url: url });
}

/** Log a change: a new version starting on `started_on`. Deck owner or admin. */
export async function createDeckVersion(deckId: string, input: VersionInput, actor: Player): Promise<DeckVersion> {
  const v = parseInput(input);
  const { db, gid } = await ctx();
  return db.transaction(async (tx) => {
    const deck = await lockDeck(tx, gid, deckId, actor);
    const list = await deckRows(tx, gid, deckId);
    assertFreeDate(list, v.started_on);
    const created: DeckVersion = {
      id: newId("v"),
      deck_id: deckId,
      version_no: 0,
      started_on: v.started_on,
      note: v.note,
      list_url: v.list_url,
      created_by: actor.player_id,
      created_at: new Date().toISOString(),
    };
    const numbered = await writeNumbered(tx, gid, deckId, [...list, created]);
    const saved = numbered.find((x) => x.id === created.id)!;
    // Only a change that is now the latest version sets the deck's current link.
    if (saved.version_no === numbered.length + 1) await setDeckListUrl(tx, gid, deck, v.list_url, actor);
    await audit(tx, gid, actor, "deck_version", saved.id, "create", undefined, saved);
    return saved;
  });
}

export async function updateDeckVersion(deckId: string, versionId: string, input: VersionInput, actor: Player): Promise<DeckVersion> {
  const v = parseInput(input);
  const { db, gid } = await ctx();
  return db.transaction(async (tx) => {
    const deck = await lockDeck(tx, gid, deckId, actor);
    const list = await deckRows(tx, gid, deckId);
    const before = list.find((x) => x.id === versionId);
    if (!before) throw new AppError("That change was not found. Reload and try again.");
    assertFreeDate(list, v.started_on, versionId);
    const next = { ...before, started_on: v.started_on, note: v.note, list_url: v.list_url };
    const numbered = await writeNumbered(tx, gid, deckId, list.map((x) => (x.id === versionId ? next : x)));
    const saved = numbered.find((x) => x.id === versionId)!;
    if (saved.version_no === numbered.length + 1) await setDeckListUrl(tx, gid, deck, v.list_url, actor);
    await audit(tx, gid, actor, "deck_version", versionId, "update", before, saved);
    return saved;
  });
}

export async function deleteDeckVersion(deckId: string, versionId: string, actor: Player) {
  const { db, gid } = await ctx();
  await db.transaction(async (tx) => {
    await lockDeck(tx, gid, deckId, actor);
    const list = await deckRows(tx, gid, deckId);
    const before = list.find((x) => x.id === versionId);
    if (!before) throw new AppError("That change was not found. Reload and try again.");
    await writeNumbered(tx, gid, deckId, list.filter((x) => x.id !== versionId));
    await audit(tx, gid, actor, "deck_version", versionId, "delete", before, undefined);
  });
}
