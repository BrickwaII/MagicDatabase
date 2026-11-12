// Turns the old "Magic Records - 2026" tabs (as 2-D string grids) into rows for
// the new layout. Pure: no I/O, so it is unit-tested and rerunnable.

import { slugify } from "./util";
import {
  GUEST_PLAYER_ID,
  normalizeColors,
  type Deck,
  type DeckCommander,
  type Game,
  type GameSeat,
  type Lookup,
  type Player,
} from "./schema";

export type Grid = string[][];

export interface OldSheet {
  games: Grid;
  decks: Grid;
  deckDetails?: Grid;
  data?: Grid;
}

export interface MigrationResult {
  players: Player[];
  decks: Deck[];
  deckCommanders: DeckCommander[];
  games: Game[];
  seats: GameSeat[];
  winConditions: Lookup[];
  rules: Lookup[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Emoji color identity

const EMOJI_COLORS: [RegExp, string][] = [
  [/⬜|◻️?|⚪|🤍|🏳️?/gu, "W"],
  [/🟦|🔵|💙|🔷/gu, "U"],
  [/⬛|◼️?|⚫|🖤/gu, "B"],
  [/🟥|🔴|❤️?|♥️?/gu, "R"],
  [/🟩|🟢|💚/gu, "G"],
  [/🟫|🟤|◇|♢|🔘|⚙️?|🩶|🔲|🔳/gu, "C"],
];

/** "🟥🟩⬜Tifa" → { colors: "WRG", name: "Tifa" } */
export function splitDeckCell(cell: string): { colors: string; name: string } {
  let rest = cell.trim();
  const letters: string[] = [];
  // Consume leading symbols until the first letter/digit of the nickname.
  for (;;) {
    const before = rest;
    for (const [re, c] of EMOJI_COLORS) {
      re.lastIndex = 0;
      const m = rest.match(new RegExp(`^(?:${re.source})`, "u"));
      if (m) {
        letters.push(c);
        rest = rest.slice(m[0].length);
      }
    }
    rest = rest.replace(/^[\s️‍]+/u, "");
    if (rest === before) break;
  }
  // Any other leading pictographs are dropped from the name.
  rest = rest.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return { colors: letters.length ? normalizeColors(letters) : "", name: rest || cell.trim() };
}

// ---------------------------------------------------------------------------
// Value parsing

/** Accepts M/D/YYYY, M/D/YY, YYYY-MM-DD, and Sheets serial day numbers. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export const fixTypos = (s: string) => s.replace(/planeschase/gi, "Planechase");

const splitMulti = (v: string) =>
  v
    .split(/[,;/\n]| and /)
    .map((x) => x.trim())
    .filter(Boolean);

const truthy = (v: string) => /^(true|yes|y|x|1|✓|✔|w|win|won|winner)$/i.test(v.trim());

// ---------------------------------------------------------------------------
// Column detection for the Games tab

export interface GamesColumns {
  date: number;
  gameNo: number;
  seat: number;
  player: number;
  deck: number;
  winner: number;
  brackets: number;
  winConditions: number;
  rules: number;
  notes: number;
}

/**
 * Formula helper columns in the real old sheet, to the right of the data:
 * "Player #" and "Winner #" (counts/seat of the winner on a game's first row),
 * and "DateFilled", "Game#Filled", "WinnerFilled", "BracketFilled", ... which
 * fill values down *across* games. Detection skips them so that e.g. "Game#Filled"
 * is never taken for the game number and "Winner #" never for the winner.
 * "SeatNumber" is a helper too: it is derived from row order (and blank on rows
 * with no player name), so row order is used directly instead.
 */
const isHelperColumn = (s: string) => /filled$/.test(s) || /^(player|winner)\s*#$/.test(s) || s === "seatnumber";

export function detectGamesColumns(header: string[]): { cols: Partial<GamesColumns>; headerRow: string[] } {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (test: (s: string) => boolean, exclude: number[] = []) => {
    const i = h.findIndex((s, idx) => s && !isHelperColumn(s) && !exclude.includes(idx) && test(s));
    return i === -1 ? undefined : i;
  };
  const date = find((s) => s.includes("date"));
  const winConditions = find((s) => /win\s*con/.test(s));
  const winner = find((s) => /winner|^won$|^win$|^w$/.test(s), [winConditions ?? -1]);
  // The real sheet's player header is "Players (In Turn Order)": that is the
  // player column, not a seat column. Seat order is then the row order.
  const seat = find((s) => /seat|turn|order|position/.test(s) && !/player/.test(s));
  // The real sheet's game-number header is just "#".
  const gameNo = find((s) => s === "#" || s === "no" || s === "no.") ?? find((s) => /game/.test(s), [seat ?? -1, date ?? -1]);
  return {
    headerRow: header,
    cols: {
      date,
      gameNo,
      seat,
      player: find((s) => /player|name/.test(s)),
      deck: find((s) => /deck|commander/.test(s)),
      winner,
      brackets: find((s) => /bracket/.test(s)),
      winConditions,
      rules: find((s) => /rule/.test(s)),
      notes: find((s) => /note/.test(s)),
    },
  };
}

/** Find the header row (the first row containing a "date" cell) within the first 10 rows. */
export function findHeaderRow(grid: Grid): number {
  const i = grid.slice(0, 10).findIndex((r) => r.some((c) => /date/i.test(c)));
  return i === -1 ? 0 : i;
}


// ---------------------------------------------------------------------------
// Lookup lists from the Data tab

function column(grid: Grid | undefined, test: RegExp): string[] {
  if (!grid || grid.length === 0) return [];
  const hi = grid.slice(0, 5).findIndex((r) => r.some((c) => test.test(c)));
  if (hi === -1) return [];
  const ci = grid[hi].findIndex((c) => test.test(c));
  return grid
    .slice(hi + 1)
    .map((r) => (r[ci] ?? "").trim())
    .filter(Boolean);
}

/**
 * A "Player | Deck | Bracket | Notes" table anywhere in the first rows of a tab.
 * Headers must be exactly "Player" and "Deck" (so the Data tab's "Players" list
 * and DeckDetails' "Player (All Pairs)" helper columns are not picked up).
 */
function deckTable(grid: Grid | undefined) {
  if (!grid) return [];
  for (let hi = 0; hi < Math.min(grid.length, 5); hi++) {
    const h = grid[hi].map((c) => c.trim().toLowerCase());
    const pi = h.indexOf("player");
    const di = h.indexOf("deck");
    if (pi === -1 || di === -1) continue;
    const near = (re: RegExp) => h.findIndex((c, i) => i > di && i <= di + 3 && re.test(c));
    const bi = near(/^brackets?$/);
    const ni = near(/^notes?$/);
    return grid
      .slice(hi + 1)
      .map((r) => ({
        player: (r[pi] ?? "").trim(),
        deck: (r[di] ?? "").trim(),
        bracket: bi >= 0 ? (r[bi] ?? "").trim() : "",
        notes: ni >= 0 ? (r[ni] ?? "").trim() : "",
      }))
      .filter((r) => r.player && r.deck);
  }
  return [];
}

function editDistance(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

// ---------------------------------------------------------------------------
// Commander seeds (scripts/commander-seeds.json)

/**
 * A seed maps a deck nickname to its commander card(s). Keys, tried in order:
 * "player_id|Deck name", "Deck name|COLORS" (e.g. "Tifa|WRG"), "Deck name".
 * Values: a card name (looked up on Scryfall later), or a list of
 * { name, oracle_id } (already confirmed; first is the commander, the rest
 * partners) which links the deck without any lookup. Keys starting with "_" are comments.
 */
export type CommanderSeed = string | { name: string; oracle_id?: string; role?: DeckCommander["role"] }[];

export function seedFor(seeds: Record<string, unknown> | undefined, deck: Pick<Deck, "owner_player_id" | "name" | "colors">) {
  if (!seeds) return undefined;
  for (const k of [`${deck.owner_player_id}|${deck.name}`, `${deck.name}|${deck.colors}`, deck.name]) {
    const v = seeds[k];
    if (typeof v === "string" || Array.isArray(v)) return v as CommanderSeed;
  }
  return undefined;
}

// ---------------------------------------------------------------------------

export interface MigrateOptions {
  commanderSeeds?: Record<string, unknown>;
  /**
   * The old sheet's "Bracket(s)" cell is blank for ~95% of games, and its own
   * stats read the fill-down "BracketFilled" helper, i.e. a blank bracket means
   * "same as the previous game". The owner decided against carrying that over:
   * by default (false) a blank bracket imports as no bracket. True restores the
   * fill-down, e.g. to reproduce the old sheet's bracket-filtered stats.
   */
  stickyBrackets?: boolean;
  /**
   * Same for "Additional Rules(s)". The old "RulesFilled" helper fills the one
   * recorded rule (a house rule listed on one early game) down to every
   * later game, but there is no evidence that is meant (no game ever resets it),
   * so the default is false: rules are only kept on the game that lists them.
   */
  stickyRules?: boolean;
}

/**
 * A guest seat's deck text from the old sheet, e.g. "Kite Tribal - Quinn", into the
 * deck they played and their name: split on the last " - " (deck left, name
 * right). Without " - " the whole text is the deck and the name stays empty;
 * parentheses are never read as a name ("Niv Mizzet (Life)" is a deck).
 */
export function parseGuestDeck(text: string): { guest_deck: string; guest_name: string } {
  const t = text.trim();
  const i = t.lastIndexOf(" - ");
  if (i === -1) return { guest_deck: t, guest_name: "" };
  return { guest_deck: t.slice(0, i).trim(), guest_name: t.slice(i + 3).trim() };
}

/** "RANDOM_Seat3", "Random_Seat1", "Guest seat 2", "Seat 4" → 3, 1, 2, 4 */
const seatRef = (v: string) => {
  const m = v.trim().match(/^(?:(?:random|guest)[\s_-]*)?seat[\s_#-]*(\d+)$/i);
  return m ? Number(m[1]) : undefined;
};

export function migrate(old: OldSheet, opts: MigrateOptions = {}): MigrationResult {
  const warnings: string[] = [];
  const stickyBrackets = opts.stickyBrackets ?? false;
  const stickyRules = opts.stickyRules ?? false;

  // Players: Decks header row + Data tab player list.
  // The real Decks tab has row labels in column A ("Player:" on the header row,
  // "Decks:" merged down the rest); those are labels, not a player or a deck.
  const isLabel = (n: string) => /^(players?|decks?)\s*:?$/i.test(n.trim());
  const playerNames = new Map<string, string>(); // lower name -> display
  const addName = (n: string) => {
    const t = n.trim();
    if (!t || isLabel(t) || t.toUpperCase() === GUEST_PLAYER_ID) return;
    if (!playerNames.has(t.toLowerCase())) playerNames.set(t.toLowerCase(), t);
  };
  const deckHeader = old.decks[0] ?? [];
  deckHeader.forEach(addName);
  column(old.data, /^players?$/i).forEach(addName);

  const players: Player[] = [];
  const idByName = new Map<string, string>();
  for (const [lower, display] of playerNames) {
    let id = slugify(display);
    for (let i = 2; players.some((p) => p.player_id === id); i++) id = `${slugify(display)}-${i}`;
    players.push({ player_id: id, display_name: display, email: "", role: "player", active: true });
    idByName.set(lower, id);
  }
  // Unknown names in Games (not in the Decks header or Data list) are added as
  // new players with a warning rather than guessed to be a misspelling of a known
  // player: the real sheet has none, and a wrong merge would corrupt two players' stats.
  const playerId = (name: string) => {
    const t = name.trim();
    if (!t) return "";
    if (t.toUpperCase() === GUEST_PLAYER_ID || /^guest$/i.test(t) || /^(random|guest)[\s_-]*seat[\s_#-]*\d+$/i.test(t)) return GUEST_PLAYER_ID;
    if (!idByName.has(t.toLowerCase())) {
      addName(t);
      const id = slugify(t);
      players.push({ player_id: id, display_name: t, email: "", role: "player", active: true });
      idByName.set(t.toLowerCase(), id);
      warnings.push(`Player "${t}" appears in Games but not in the Decks header; added.`);
    }
    return idByName.get(t.toLowerCase())!;
  };

  // Decks: one column per player. The Decks tab is the deck list; other tabs
  // (DeckDetails, Data) only annotate decks found here.
  const decks: Deck[] = [];
  const deckByKey = new Map<string, Deck>(); // owner|raw cell (lowercased)
  const deckByOwnerName = new Map<string, Deck[]>(); // owner|name (lowercased) -> decks
  const addDeck = (owner: string, cell: string) => {
    const raw = cell.trim();
    const key = `${owner}|${raw.toLowerCase()}`;
    if (!raw || deckByKey.has(key)) return deckByKey.get(key);
    const split = splitDeckCell(raw);
    const { colors } = split;
    // "Vex(Precon)" / "Vex (precon)": the deck is "Vex"; "Precon" goes in its notes.
    const precon = split.name.match(/^(.*\S)\s*\(\s*precon\s*\)$/iu);
    const name = precon ? precon[1] : split.name;
    const nameKey = `${owner}|${name.toLowerCase()}`;
    const sameName = deckByOwnerName.get(nameKey) ?? [];
    // Same nickname and same colors with the emoji in another order (e.g. 🟦🟥⬜ vs
    // 🟥⬜🟦): one deck. Same nickname in other colors is a different deck: the
    // real sheet has two "Iron Man" decks for one player (🟥 and 🟦🟥).
    const existing = sameName.find((d) => d.colors === (colors || "C"));
    if (existing) {
      deckByKey.set(key, existing);
      return existing;
    }
    const base = `d_${owner}_${slugify(name)}`;
    let id = decks.some((d) => d.deck_id === base) ? `${base}-${(colors || "C").toLowerCase()}` : base;
    for (let i = 2; decks.some((d) => d.deck_id === id); i++) id = `${base}-${i}`;
    if (!colors) warnings.push(`Deck "${raw}" (${owner}) has no color emoji; colors left as C.`);
    const deck: Deck = {
      deck_id: id,
      owner_player_id: owner,
      name,
      colors: colors || "C",
      bracket: "",
      notes: precon ? "Precon" : "",
      commander_status: "unresolved",
      active: true,
      list_url: "",
    };
    decks.push(deck);
    deckByKey.set(key, deck);
    deckByOwnerName.set(nameKey, [...sameName, deck]);
    return deck;
  };
  /**
   * An owner's existing deck for a cell: exact cell, then same nickname, then a
   * single same-colored deck whose nickname is a typo (edit distance ≤ 2) or a
   * longer form ("Yarok" → "Yarok - Wraiths") of it. The real DeckDetails tab has
   * stale/typo rows like "Yuiko" for "Yuriko" and "Nine-Fingers Keae" for "Keane".
   */
  const findOwnDeck = (owner: string, cell: string) => {
    const raw = cell.trim().toLowerCase();
    const hit = deckByKey.get(`${owner}|${raw}`);
    if (hit) return hit;
    const { colors, name } = splitDeckCell(cell);
    const n = name.toLowerCase();
    const byName = (deckByOwnerName.get(`${owner}|${n}`) ?? []).filter((d) => !colors || d.colors === colors);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) return undefined;
    const near = decks.filter((d) => {
      if (d.owner_player_id !== owner || (colors && d.colors !== colors)) return false;
      const dn = d.name.toLowerCase();
      return (n.length >= 4 && editDistance(dn, n) <= 2) || (n.length >= 4 && dn.startsWith(`${n} `)) || (dn.length >= 4 && n.startsWith(`${dn} `));
    });
    if (near.length !== 1) return undefined;
    const msg = `Deck "${cell.trim()}" (${owner}) read as their "${near[0].name}" (typo or short form).`;
    if (!warnings.includes(msg)) warnings.push(msg);
    return near[0];
  };
  /**
   * Borrowed decks: a cell ending in "(<another player's name>)", e.g.
   * "🟦🟥⬜Tidus (Sam)" in Alex's column, is Sam's Tidus played by Alex.
   * Other parentheses are part of the nickname, except "(Precon)", which addDeck
   * strips from the name and records in the deck notes.
   */
  const borrowedFrom = (pilot: string, cell: string) => {
    const m = cell.trim().match(/^(.*\S)\s*\(([^()]+)\)$/u);
    if (!m) return undefined;
    const owner = idByName.get(m[2].trim().toLowerCase());
    if (!owner || owner === pilot) return undefined;
    return { owner, cell: m[1] };
  };
  /** The owner's deck for a borrowed cell, ignoring color/emoji differences; created (with a warning) if missing. */
  const lenderDeck = (owner: string, cell: string, raw: string) => {
    const hit = findOwnDeck(owner, cell);
    if (hit) return hit;
    const { colors, name } = splitDeckCell(cell);
    const same = decks.filter((d) => d.owner_player_id === owner && d.name.toLowerCase() === name.toLowerCase());
    if (same.length) {
      const pick = same.find((d) => d.colors === colors) ?? same[0];
      if (same.length > 1) warnings.push(`Borrowed deck "${raw}": ${owner} has ${same.length} decks named "${name}"; used ${pick.colors} one.`);
      return pick;
    }
    const msg = `Borrowed deck "${raw}": ${owner} has no "${name}" in the Decks tab; added for them.`;
    if (!warnings.includes(msg)) warnings.push(msg);
    return addDeck(owner, cell)!;
  };

  const borrowedCells: { owner: string; cell: string; raw: string }[] = [];
  deckHeader.forEach((name, ci) => {
    if (!name.trim() || isLabel(name) || name.trim().toUpperCase() === GUEST_PLAYER_ID) return;
    const owner = playerId(name);
    for (const row of old.decks.slice(1)) {
      if (!row[ci]?.trim()) continue;
      const b = borrowedFrom(owner, row[ci]);
      // Not a deck of the column's player; resolved once every owner's list is read.
      if (b) borrowedCells.push({ ...b, raw: row[ci].trim() });
      else addDeck(owner, row[ci]);
    }
  });
  for (const b of borrowedCells) lenderDeck(b.owner, b.cell, b.raw);

  // DeckDetails and the Data tab's Player/Deck/Bracket table: bracket + notes.
  for (const r of [...deckTable(old.deckDetails), ...deckTable(old.data)]) {
    if (!r.bracket && !r.notes) continue;
    // A borrower's row doesn't annotate the owner's deck; the owner's own row does.
    if (borrowedFrom(playerId(r.player), r.deck)) continue;
    const d = findOwnDeck(playerId(r.player), r.deck);
    if (!d) {
      warnings.push(`Deck details for "${r.deck}" (${r.player}) don't match a deck in the Decks tab; ignored.`);
      continue;
    }
    if (r.bracket) d.bracket = splitMulti(r.bracket).filter((b) => /^[1-5]$/.test(b)).sort().pop() ?? d.bracket;
    if (r.notes) d.notes = r.notes;
  }

  // Lookups
  const winConditions: Lookup[] = [];
  const rules: Lookup[] = [];
  const lookupId = (list: Lookup[], name: string) => {
    const n = fixTypos(name.trim());
    if (!n) return "";
    const hit = list.find((l) => l.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit.id;
    let id = slugify(n);
    for (let i = 2; list.some((l) => l.id === id); i++) id = `${slugify(n)}-${i}`;
    list.push({ id, name: n });
    return id;
  };
  column(old.data, /win\s*con/i).forEach((n) => lookupId(winConditions, n));
  column(old.data, /rule/i).forEach((n) => lookupId(rules, n));

  // Games. In the real sheet each game is a block of rows whose Date, #, Winner,
  // Bracket(s), Win Condition(s), Additional Rules(s) and Notes are merged cells,
  // which a CSV export / the values API leaves blank except on the block's first
  // row. So a row with a date or a game # starts a new game and the rows below
  // belong to it until the next one.
  const hi = findHeaderRow(old.games);
  const { cols } = detectGamesColumns(old.games[hi] ?? []);
  for (const k of ["date", "player"] as const) {
    if (cols[k] === undefined) throw new Error(`Games tab: couldn't find a "${k}" column in the header row`);
  }
  const cell = (r: string[], k: keyof GamesColumns) => (cols[k] === undefined ? "" : (r[cols[k]!] ?? "").trim());

  interface Pending {
    date: string;
    no: string;
    sheetRow: number;
    rows: { r: string[]; sheetRow: number }[];
  }
  const groups: Pending[] = [];
  let cur: Pending | null = null;
  let lastDate = "";
  for (const [i, r] of old.games.slice(hi + 1).entries()) {
    const sheetRow = hi + i + 2;
    const rawDate = cell(r, "date");
    const rawNo = cell(r, "gameNo");
    const hasSeat = Boolean(cell(r, "player") || cell(r, "deck"));
    const restartsSeats = cols.gameNo === undefined && !rawDate && cell(r, "seat") === "1" && cur && cur.rows.length > 0;
    if (rawDate || rawNo || restartsSeats) {
      const date = rawDate ? parseDate(rawDate) : lastDate;
      if (rawDate && !date) {
        warnings.push(`Games row ${sheetRow}: unreadable date "${rawDate}"; game skipped.`);
        cur = null;
        continue;
      }
      if (!date) {
        warnings.push(`Games row ${sheetRow}: game # "${rawNo}" before any date; skipped.`);
        cur = null;
        continue;
      }
      cur = { date, no: rawNo, sheetRow, rows: [] };
      groups.push(cur);
      lastDate = date;
    }
    if (!hasSeat) continue;
    if (!cur) {
      warnings.push(`Games row ${sheetRow}: seat before the first game; skipped.`);
      continue;
    }
    cur.rows.push({ r, sheetRow });
  }

  // The real sheet pre-numbers empty games at the bottom (a date and # with no
  // seats). Those are dropped, with one summary warning.
  const empty = groups.filter((g) => g.rows.length === 0);
  if (empty.length) {
    const label = (g: Pending) => `${g.date}${g.no ? ` #${g.no}` : ""}`;
    warnings.push(
      `${empty.length} game slot(s) with no players skipped: ${empty.length <= 3 ? empty.map(label).join(", ") : `${label(empty[0])} … ${label(empty[empty.length - 1])}`}.`,
    );
  }

  const games: Game[] = [];
  const seats: GameSeat[] = [];
  const dayCounter = new Map<string, number>();
  let lastBrackets: string[] = [];
  let lastRules: string[] = [];
  for (const g of groups.filter((x) => x.rows.length > 0)) {
    const first = (k: keyof GamesColumns) => g.rows.map(({ r }) => cell(r, k)).find(Boolean) ?? "";
    const n = (dayCounter.get(g.date) ?? 0) + 1;
    dayCounter.set(g.date, n);
    // The old game # is only used for grouping; numbers are reassigned per day.
    const dayNo = n;
    const gameId = `m_${g.date}_${String(dayNo).padStart(2, "0")}`;
    const label = `Game ${g.date} #${dayNo} (row ${g.sheetRow})`;

    const ordered = g.rows
      .map((row, idx) => ({ ...row, order: Number(cell(row.r, "seat")) || idx + 1 }))
      .sort((a, b) => a.order - b.order);

    const gameSeats: GameSeat[] = ordered.map(({ r }, idx) => {
      const name = cell(r, "player");
      const deckCell = cell(r, "deck");
      // A deck with no player name (real sheet: two rows of one game list only a
      // deck) is still a seat at the table; it is imported as a guest.
      if (!name) warnings.push(`${label}: seat ${idx + 1} has deck "${deckCell}" but no player; imported as a guest (${GUEST_PLAYER_ID}).`);
      const pid = name ? playerId(name) : GUEST_PLAYER_ID;
      let deck_id = "";
      const borrowed = pid !== GUEST_PLAYER_ID && deckCell ? borrowedFrom(pid, deckCell) : undefined;
      // Guests' decks (free text like "Caesar - <guest name>") are not imported as
      // decks; they become the seat's guest_deck and guest_name.
      const guest = pid === GUEST_PLAYER_ID ? parseGuestDeck(deckCell) : { guest_deck: "", guest_name: "" };
      if (borrowed) deck_id = lenderDeck(borrowed.owner, borrowed.cell, deckCell).deck_id;
      else if (pid !== GUEST_PLAYER_ID && deckCell) {
        const own = findOwnDeck(pid, deckCell);
        if (own) deck_id = own.deck_id;
        else {
          const others = decks.filter((d) => splitDeckCell(deckCell).name.toLowerCase() === d.name.toLowerCase());
          if (others.length === 1) deck_id = others[0].deck_id;
          else {
            deck_id = addDeck(pid, deckCell)!.deck_id;
            warnings.push(`${label}: deck "${deckCell}" not in ${pid}'s list; added for them.`);
          }
        }
      } else if (pid !== GUEST_PLAYER_ID) {
        // Kept as a seat with no deck: the game and the result still count.
        warnings.push(`${label}: ${name} has no deck recorded; seat imported without a deck.`);
      }
      return { game_id: gameId, seat: idx + 1, player_id: pid, deck_id, is_winner: false, ...guest, guest_added_by: "" };
    });

    // Winner: the real sheet has one merged "Winner" cell per game holding a
    // player name, or "RANDOM_Seat<N>" / "Random_Seat<N>" for a guest at seat N
    // (1-based turn order). Per-row TRUE/x flags and deck names are also accepted.
    ordered.forEach(({ r }, idx) => {
      if (truthy(cell(r, "winner"))) gameSeats[idx].is_winner = true;
    });
    const winnerValues = [...new Set(g.rows.map(({ r }) => cell(r, "winner")).filter((w) => w && !truthy(w) && !/^(false|no|n|0)$/i.test(w)))];
    for (const w of winnerValues) {
      const ref = seatRef(w);
      if (ref !== undefined) {
        const s = gameSeats[ref - 1];
        if (!s) warnings.push(`${label}: winner "${w}" but the game has ${gameSeats.length} seats; no winner set.`);
        else {
          if (s.player_id !== GUEST_PLAYER_ID) warnings.push(`${label}: winner "${w}" points at ${s.player_id}, not a guest; marked anyway.`);
          s.is_winner = true;
        }
        continue;
      }
      const lw = w.toLowerCase();
      let hits = ordered.map(({ r }, idx) => (cell(r, "player").toLowerCase() === lw ? idx : -1)).filter((x) => x >= 0);
      if (!hits.length) hits = ordered.map(({ r }, idx) => (cell(r, "deck").toLowerCase() === lw || splitDeckCell(cell(r, "deck")).name.toLowerCase() === lw ? idx : -1)).filter((x) => x >= 0);
      if (hits.length === 1) gameSeats[hits[0]].is_winner = true;
      else if (hits.length > 1) warnings.push(`${label}: winner "${w}" matches ${hits.length} seats; no winner set.`);
      else warnings.push(`${label}: winner "${w}" is not seated in this game; ignored.`);
    }

    // No winner (real sheet: one recent game has a blank Winner) →
    // imported as "unfinished": kept for history, excluded from stats. (The old
    // sheet's WinnerFilled helper instead credited the previous game's winner.)
    // Two or more winners don't occur in the real sheet; if they do, all are kept
    // and the game stays "won", with a warning to review it.
    const winners = gameSeats.filter((s) => s.is_winner).length;
    if (winners === 0) warnings.push(`${label}: no winner recorded; imported as unfinished.`);
    if (winners > 1) warnings.push(`${label}: ${winners} winners; check this game.`);
    if (gameSeats.length < 3 || gameSeats.length > 6) warnings.push(`${label}: ${gameSeats.length} seats (expected 3–6).`);

    let brackets = [...new Set(splitMulti(first("brackets")).filter((b) => /^[1-5]$/.test(b)))].sort();
    if (brackets.length) lastBrackets = brackets;
    else if (stickyBrackets) brackets = lastBrackets;
    let additional_rules = [
      ...new Set(
        splitMulti(first("rules"))
          .filter((r) => !/^(none|n\/a|-)$/i.test(r))
          .map((r) => lookupId(rules, r)),
      ),
    ];
    if (first("rules")) lastRules = additional_rules;
    else if (stickyRules) additional_rules = lastRules;

    games.push({
      game_id: gameId,
      day_game_no: dayNo,
      date: g.date,
      status: "approved",
      result: winners === 0 ? "unfinished" : "won",
      brackets: [...brackets],
      win_conditions: [...new Set(splitMulti(first("winConditions")).map((w) => lookupId(winConditions, w)))],
      additional_rules: [...additional_rules],
      notes: g.rows.map(({ r }) => cell(r, "notes")).filter(Boolean).join(" · "),
      submitted_by: "import",
      approved_by: "import",
      rev: 1,
      reject_reason: "",
    });
    seats.push(...gameSeats);
  }

  // Commanders: one row per seeded card (confirmed seeds link the deck now),
  // otherwise the deck nickname is left as typed_name for a Scryfall lookup.
  const deckCommanders: DeckCommander[] = [];
  for (const d of decks) {
    const seed = seedFor(opts.commanderSeeds, d);
    if (Array.isArray(seed) && seed.length) {
      const confirmed = seed.every((c) => c.oracle_id);
      seed.forEach((c, i) =>
        deckCommanders.push({
          deck_id: d.deck_id,
          slot: i + 1,
          role: i === 0 ? "commander" : (c.role ?? "partner"),
          scryfall_oracle_id: confirmed ? c.oracle_id! : "",
          card_name: confirmed ? c.name : "",
          typed_name: c.name,
        }),
      );
      if (confirmed) d.commander_status = "resolved";
      continue;
    }
    deckCommanders.push({
      deck_id: d.deck_id,
      slot: 1,
      role: "commander",
      scryfall_oracle_id: "",
      card_name: "",
      typed_name: typeof seed === "string" ? seed : d.name,
    });
  }

  return { players, decks, deckCommanders, games, seats, winConditions, rules, warnings };
}
