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

export function detectGamesColumns(header: string[]): { cols: Partial<GamesColumns>; headerRow: string[] } {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (test: (s: string) => boolean, exclude: number[] = []) => {
    const i = h.findIndex((s, idx) => s && !exclude.includes(idx) && test(s));
    return i === -1 ? undefined : i;
  };
  const date = find((s) => s.includes("date"));
  const winConditions = find((s) => /win\s*con/.test(s));
  const winner = find((s) => /winner|^won$|^win$|^w$/.test(s), [winConditions ?? -1]);
  const seat = find((s) => /seat|turn|order|position/.test(s));
  const gameNo = find((s) => /game/.test(s), [seat ?? -1, date ?? -1]);
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

// ---------------------------------------------------------------------------

export function migrate(old: OldSheet, opts: { commanderSeeds?: Record<string, string> } = {}): MigrationResult {
  const warnings: string[] = [];

  // Players: Decks header row + Data tab player list.
  const playerNames = new Map<string, string>(); // lower name -> display
  const addName = (n: string) => {
    const t = n.trim();
    if (!t || t.toUpperCase() === GUEST_PLAYER_ID) return;
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
  const playerId = (name: string) => {
    const t = name.trim();
    if (!t) return "";
    if (t.toUpperCase() === GUEST_PLAYER_ID || /^guest$/i.test(t)) return GUEST_PLAYER_ID;
    if (!idByName.has(t.toLowerCase())) {
      addName(t);
      const id = slugify(t);
      players.push({ player_id: id, display_name: t, email: "", role: "player", active: true });
      idByName.set(t.toLowerCase(), id);
      warnings.push(`Player "${t}" appears in Games but not in the Decks header; added.`);
    }
    return idByName.get(t.toLowerCase())!;
  };

  // Decks: one column per player.
  const decks: Deck[] = [];
  const deckByKey = new Map<string, Deck>(); // owner|raw cell (lowercased)
  const deckByOwnerName = new Map<string, Deck>(); // owner|name (lowercased)
  const addDeck = (owner: string, cell: string) => {
    const raw = cell.trim();
    const key = `${owner}|${raw.toLowerCase()}`;
    if (!raw || deckByKey.has(key)) return deckByKey.get(key);
    const { colors, name } = splitDeckCell(raw);
    const nameKey = `${owner}|${name.toLowerCase()}`;
    const existing = deckByOwnerName.get(nameKey);
    if (existing) {
      deckByKey.set(key, existing);
      return existing;
    }
    let id = `d_${owner}_${slugify(name)}`;
    for (let i = 2; decks.some((d) => d.deck_id === id); i++) id = `d_${owner}_${slugify(name)}-${i}`;
    if (!colors) warnings.push(`Deck "${raw}" (${owner}) has no color emoji; colors left as C.`);
    const deck: Deck = {
      deck_id: id,
      owner_player_id: owner,
      name,
      colors: colors || "C",
      bracket: "",
      notes: "",
      commander_status: "unresolved",
      active: true,
    };
    decks.push(deck);
    deckByKey.set(key, deck);
    deckByOwnerName.set(nameKey, deck);
    return deck;
  };
  deckHeader.forEach((name, ci) => {
    if (!name.trim() || name.trim().toUpperCase() === GUEST_PLAYER_ID) return;
    const owner = playerId(name);
    for (const row of old.decks.slice(1)) if (row[ci]?.trim()) addDeck(owner, row[ci]);
  });

  // DeckDetails: player, deck, bracket, notes.
  if (old.deckDetails && old.deckDetails.length > 1) {
    const hh = old.deckDetails[0].map((x) => x.toLowerCase());
    const pi = hh.findIndex((x) => x.includes("player"));
    const di = hh.findIndex((x) => x.includes("deck"));
    const bi = hh.findIndex((x) => x.includes("bracket"));
    const ni = hh.findIndex((x) => x.includes("note"));
    for (const r of old.deckDetails.slice(1)) {
      if (pi < 0 || di < 0 || !r[pi]?.trim() || !r[di]?.trim()) continue;
      const d = addDeck(playerId(r[pi]), r[di]);
      if (!d) continue;
      if (bi >= 0 && r[bi]?.trim()) d.bracket = splitMulti(r[bi]).filter((b) => /^[1-5]$/.test(b)).sort().pop() ?? "";
      if (ni >= 0 && r[ni]?.trim()) d.notes = r[ni].trim();
    }
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

  // Games: fill down merged cells, group by date + game number.
  const hi = findHeaderRow(old.games);
  const { cols } = detectGamesColumns(old.games[hi] ?? []);
  for (const k of ["date", "player"] as const) {
    if (cols[k] === undefined) throw new Error(`Games tab: couldn't find a "${k}" column in the header row`);
  }
  const cell = (r: string[], k: keyof GamesColumns) => (cols[k] === undefined ? "" : (r[cols[k]!] ?? "").trim());

  interface Pending {
    date: string;
    no: string;
    rows: string[][];
  }
  const groups: Pending[] = [];
  let lastDate = "";
  let lastNo = "";
  for (const [i, r] of old.games.slice(hi + 1).entries()) {
    const player = cell(r, "player");
    const rawDate = cell(r, "date");
    const rawNo = cell(r, "gameNo");
    if (!player) {
      if (rawDate || rawNo) warnings.push(`Games row ${hi + i + 2}: no player; skipped.`);
      continue;
    }
    const date = rawDate ? parseDate(rawDate) : lastDate;
    if (rawDate && !date) {
      warnings.push(`Games row ${hi + i + 2}: unreadable date "${rawDate}"; skipped.`);
      continue;
    }
    if (rawDate && date !== lastDate && !rawNo) lastNo = "";
    const no = rawNo || lastNo;
    const seatNo = cell(r, "seat");
    const prev = groups[groups.length - 1];
    // A new game starts when date or game # changes, or seat order restarts at 1.
    const startsNew = !prev || prev.date !== date || prev.no !== no || (cols.gameNo === undefined && seatNo === "1");
    if (startsNew) groups.push({ date: date!, no, rows: [r] });
    else prev.rows.push(r);
    lastDate = date!;
    lastNo = no;
  }

  const games: Game[] = [];
  const seats: GameSeat[] = [];
  const dayCounter = new Map<string, number>();
  for (const g of groups) {
    const first = (k: keyof GamesColumns) => g.rows.map((r) => cell(r, k)).find(Boolean) ?? "";
    const n = (dayCounter.get(g.date) ?? 0) + 1;
    dayCounter.set(g.date, n);
    // The old game # is only used for grouping; numbers are reassigned per day.
    const dayNo = n;
    const gameId = `m_${g.date}_${String(dayNo).padStart(2, "0")}`;

    const winnerNames = g.rows.map((r) => cell(r, "winner")).filter((w) => w && !truthy(w) && !/^(false|no|n|0)$/i.test(w));
    const ordered = g.rows
      .map((r, idx) => ({ r, order: Number(cell(r, "seat")) || idx + 1 }))
      .sort((a, b) => a.order - b.order);

    const gameSeats: GameSeat[] = ordered.map(({ r }, idx) => {
      const pid = playerId(cell(r, "player"));
      const deckCell = cell(r, "deck");
      let deck_id = "";
      if (pid !== GUEST_PLAYER_ID && deckCell) {
        const own = deckByKey.get(`${pid}|${deckCell.toLowerCase()}`) ?? deckByOwnerName.get(`${pid}|${splitDeckCell(deckCell).name.toLowerCase()}`);
        if (own) deck_id = own.deck_id;
        else {
          const others = decks.filter((d) => splitDeckCell(deckCell).name.toLowerCase() === d.name.toLowerCase());
          if (others.length === 1) deck_id = others[0].deck_id;
          else {
            deck_id = addDeck(pid, deckCell)!.deck_id;
            warnings.push(`Game ${g.date} #${dayNo}: deck "${deckCell}" not in ${pid}'s list; added for them.`);
          }
        }
      }
      const w = cell(r, "winner");
      const isWinner =
        truthy(w) ||
        winnerNames.some((name) => name.toLowerCase() === cell(r, "player").toLowerCase()) ||
        (deckCell !== "" && winnerNames.some((name) => name.toLowerCase() === deckCell.toLowerCase()));
      return { game_id: gameId, seat: idx + 1, player_id: pid, deck_id, is_winner: isWinner };
    });

    if (!gameSeats.some((s) => s.is_winner)) warnings.push(`Game ${g.date} #${dayNo}: no winner found.`);

    games.push({
      game_id: gameId,
      day_game_no: dayNo,
      date: g.date,
      status: "approved",
      result: "won",
      brackets: [...new Set(splitMulti(first("brackets")).filter((b) => /^[1-5]$/.test(b)))].sort(),
      win_conditions: splitMulti(first("winConditions")).map((w) => lookupId(winConditions, w)),
      additional_rules: splitMulti(first("rules"))
        .filter((r) => !/^(none|n\/a|-)$/i.test(r))
        .map((r) => lookupId(rules, r)),
      notes: g.rows.map((r) => cell(r, "notes")).filter(Boolean).join(" · "),
      submitted_by: "import",
      approved_by: "import",
      rev: 1,
      reject_reason: "",
    });
    seats.push(...gameSeats);
  }

  // Commander seeds: "owner|deck name" -> exact card name (resolved later via Scryfall).
  const deckCommanders: DeckCommander[] = [];
  for (const d of decks) {
    const seed = opts.commanderSeeds?.[`${d.owner_player_id}|${d.name}`] ?? opts.commanderSeeds?.[d.name];
    deckCommanders.push({
      deck_id: d.deck_id,
      slot: 1,
      role: "commander",
      scryfall_oracle_id: "",
      card_name: "",
      typed_name: seed ?? d.name,
    });
  }

  return { players, decks, deckCommanders, games, seats, winConditions, rules, warnings };
}
