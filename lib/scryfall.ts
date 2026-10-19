// Scryfall helpers shared by the deck form (browser) and the migration script
// (Node). The API is free and keyless; Scryfall asks for <= 10 requests/sec.

export interface ScryCard {
  id: string;
  oracle_id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  color_identity: string[];
  keywords: string[];
  image?: string;
}

interface RawCard {
  id: string;
  oracle_id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  color_identity?: string[];
  keywords?: string[];
  image_uris?: { small?: string; normal?: string };
  card_faces?: { oracle_id?: string; oracle_text?: string; type_line?: string; image_uris?: { small?: string } }[];
}

export function toCard(c: RawCard): ScryCard {
  const faces = c.card_faces ?? [];
  return {
    id: c.id,
    oracle_id: c.oracle_id ?? faces[0]?.oracle_id ?? "",
    name: c.name,
    type_line: c.type_line ?? faces.map((f) => f.type_line).filter(Boolean).join(" // "),
    oracle_text: c.oracle_text ?? faces.map((f) => f.oracle_text ?? "").join("\n"),
    color_identity: c.color_identity ?? [],
    keywords: c.keywords ?? [],
    image: c.image_uris?.small ?? faces[0]?.image_uris?.small,
  };
}

const API = "https://api.scryfall.com";
const isNode = typeof window === "undefined";

async function get(url: string): Promise<Response> {
  return fetch(url, {
    headers: isNode ? { "User-Agent": "CommanderTracker/0.1", Accept: "application/json" } : { Accept: "application/json" },
  });
}

/** Run a Scryfall search query; returns [] for "no cards found". */
export async function search(q: string, limit = 20): Promise<ScryCard[]> {
  const res = await get(`${API}/cards/search?order=edhrec&unique=cards&q=${encodeURIComponent(q)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
  const body = (await res.json()) as { data: RawCard[] };
  return body.data.slice(0, limit).map(toCard);
}

/** Exact or fuzzy single-card lookup by name. */
export async function named(name: string, fuzzy = true): Promise<ScryCard | null> {
  const res = await get(`${API}/cards/named?${fuzzy ? "fuzzy" : "exact"}=${encodeURIComponent(name)}`);
  if (!res.ok) return null;
  return toCard((await res.json()) as RawCard);
}

const quote = (s: string) => `"${s.replace(/"/g, "")}"`;

/** Legal commanders whose name matches the typed text. */
export function commanderQuery(text: string) {
  return `is:commander game:paper name:${quote(text.trim())}`;
}

// ---------------------------------------------------------------------------
// Pairing rules for a second commander

export type PairKind =
  | { kind: "partner" }
  | { kind: "partner-with"; name: string }
  | { kind: "partner-variant"; variant: string }
  | { kind: "friends-forever" }
  | { kind: "background-chooser" }
  | { kind: "background" }
  | { kind: "doctors-companion" }
  | { kind: "time-lord-doctor" };

/** The pairing abilities a card has, read from its rules text and type line. */
export function pairKinds(card: Pick<ScryCard, "oracle_text" | "type_line">): PairKind[] {
  const text = card.oracle_text ?? "";
  const type = card.type_line ?? "";
  const out: PairKind[] = [];
  for (const line of text.split("\n")) {
    const l = line.trim();
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^Partner with ([^(]+?)(?:\s*\(|$)/))) out.push({ kind: "partner-with", name: m[1].trim() });
    else if ((m = l.match(/^Partner\s*[—-]\s*([^(]+?)(?:\s*\(|$)/))) out.push({ kind: "partner-variant", variant: m[1].trim().toLowerCase() });
    else if (/^Partner(\s*\(|$)/.test(l)) out.push({ kind: "partner" });
    if (/^Friends forever(\s*\(|$)/i.test(l)) out.push({ kind: "friends-forever" });
    if (/^Choose a Background(\s*\(|$)/i.test(l)) out.push({ kind: "background-chooser" });
    if (/^Doctor's companion(\s*\(|$)/i.test(l)) out.push({ kind: "doctors-companion" });
  }
  if (/\bBackground\b/.test(type) && /\bEnchantment\b/.test(type)) out.push({ kind: "background" });
  if (/Time Lord Doctor/.test(type)) out.push({ kind: "time-lord-doctor" });
  return out;
}

export function canPair(a: Pick<ScryCard, "name" | "oracle_text" | "type_line">, b: Pick<ScryCard, "name" | "oracle_text" | "type_line">) {
  if (a.name === b.name) return false;
  const ka = pairKinds(a);
  const kb = pairKinds(b);
  const has = (ks: PairKind[], kind: PairKind["kind"]) => ks.some((k) => k.kind === kind);
  if (has(ka, "partner") && has(kb, "partner")) return true;
  if (has(ka, "friends-forever") && has(kb, "friends-forever")) return true;
  const pw = (ks: PairKind[], name: string) => ks.some((k) => k.kind === "partner-with" && k.name === name);
  if (pw(ka, b.name) && pw(kb, a.name)) return true;
  const variants = (ks: PairKind[]) => ks.flatMap((k) => (k.kind === "partner-variant" ? [k.variant] : []));
  if (variants(ka).some((v) => variants(kb).includes(v))) return true;
  if ((has(ka, "background-chooser") && has(kb, "background")) || (has(kb, "background-chooser") && has(ka, "background"))) return true;
  if ((has(ka, "doctors-companion") && has(kb, "time-lord-doctor")) || (has(kb, "doctors-companion") && has(ka, "time-lord-doctor"))) return true;
  return false;
}

/** Scryfall query for candidate second commanders; results still go through canPair. */
export function partnerQuery(first: ScryCard, text: string): string | null {
  const kinds = pairKinds(first);
  const name = text.trim() ? ` name:${quote(text)}` : "";
  const parts: string[] = [];
  for (const k of kinds) {
    if (k.kind === "partner") parts.push(`(is:commander keyword:partner)`);
    if (k.kind === "partner-with") parts.push(`!${quote(k.name)}`);
    if (k.kind === "partner-variant") parts.push(`(is:commander o:${quote(`Partner—${k.variant}`)})`);
    if (k.kind === "friends-forever") parts.push(`(is:commander keyword:"friends forever")`);
    if (k.kind === "background-chooser") parts.push(`(t:background t:enchantment)`);
    if (k.kind === "background") parts.push(`(is:commander o:"Choose a Background")`);
    if (k.kind === "doctors-companion") parts.push(`(t:"time lord doctor")`);
    if (k.kind === "time-lord-doctor") parts.push(`(is:commander keyword:"doctor's companion")`);
  }
  if (parts.length === 0) return null;
  return `(${parts.join(" or ")}) game:paper${name}`;
}

/** Companions: cards with the Companion keyword. */
export function companionQuery(text: string) {
  return `keyword:companion game:paper${text.trim() ? ` name:${quote(text)}` : ""}`;
}

export async function byOracleId(oracleId: string): Promise<ScryCard | null> {
  const [card] = await search(`oracleid:${oracleId}`, 1);
  return card ?? null;
}

/** Union of color identities as WUBRG letters; "C" when colorless. */
export function identityOf(cards: Pick<ScryCard, "color_identity">[]) {
  const set = new Set(cards.flatMap((c) => c.color_identity));
  return ["W", "U", "B", "R", "G"].filter((c) => set.has(c)).join("") || "C";
}
