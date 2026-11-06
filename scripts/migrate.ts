// One-time import from the old "Magic Records - 2026" sheet into Postgres.
//
//   npm run migrate                      dry run: read, transform, write migration-report.md
//   npm run migrate -- --write           also write the database (DATABASE_URL, or local PGlite)
//   npm run migrate -- --write --force   keep games already entered through the app and re-import the rest
//   npm run migrate -- --csv-dir ./old   read CSV exports (Games.csv, Decks.csv, ...) instead of the API
//   npm run migrate -- --no-scryfall     skip commander lookups
//
// The old sheet is only read. Rerunnable until cutover: migrated rows have
// stable ids (m_..., d_...), and players' emails/roles and commanders already
// linked in the database are kept. Parsing lives in lib/migrate.ts; writing in
// lib/db/import.ts.
import "./env";
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "../lib/csv";
import { openForScripts } from "../lib/db";
import { ensureDefaultGroup } from "../lib/db/group";
import { importMigration } from "../lib/db/import";
import { migrate, type Grid, type MigrationResult } from "../lib/migrate";
import type { GameWithSeats } from "../lib/schema";
import { commanderQuery, identityOf, search, type ScryCard } from "../lib/scryfall";
import { playerStats, seatStats } from "../lib/stats";
import { OldSheetReader } from "./old-sheet";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

const OLD_TABS = {
  games: "Games",
  decks: "Decks",
  deckDetails: "DeckDetails",
  data: "Data",
  playerStats: "Player Statistics",
  turnStats: "Turn Order Statistics",
};

async function readOld(): Promise<Record<keyof typeof OLD_TABS, Grid>> {
  const out = {} as Record<keyof typeof OLD_TABS, Grid>;
  const dir = opt("--csv-dir");
  if (dir) {
    for (const [k, tab] of Object.entries(OLD_TABS)) {
      const file = [`${tab}.csv`, `${tab.replace(/ /g, "")}.csv`].map((f) => path.join(dir, f)).find(fs.existsSync);
      out[k as keyof typeof OLD_TABS] = file ? parseCsv(fs.readFileSync(file, "utf8")) : [];
    }
    return out;
  }
  const id = process.env.OLD_SPREADSHEET_ID;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!id || !key) throw new Error("Set OLD_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_KEY, or pass --csv-dir");
  const old = new OldSheetReader(id, key);
  for (const [k, tab] of Object.entries(OLD_TABS)) {
    try {
      out[k as keyof typeof OLD_TABS] = await old.readValues(tab);
    } catch (e) {
      console.warn(`Couldn't read tab "${tab}": ${(e as Error).message}`);
      out[k as keyof typeof OLD_TABS] = [];
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when every color of `card` is inside `deck` (both WUBRG letter strings; "C" = colorless). */
function withinColors(card: string, deck: string) {
  return card === "C" || [...card].every((ch) => deck.includes(ch));
}

/**
 * Link decks to Scryfall cards. Each slot links when exactly one legal commander matches its
 * name and fits inside the deck's colors; a deck is marked resolved only when all its
 * commander/partner slots linked and their combined identity equals the deck's colors,
 * so partner pairs (e.g. Pako + Haldan) resolve correctly.
 */
async function resolveCommanders(res: MigrationResult) {
  const cards = new Map<(typeof res.deckCommanders)[number], ScryCard>();
  for (const c of res.deckCommanders) {
    if (c.scryfall_oracle_id || !c.typed_name) continue;
    const deck = res.decks.find((d) => d.deck_id === c.deck_id)!;
    await sleep(120);
    try {
      const hits = (await search(commanderQuery(c.typed_name), 50)).filter(
        (card) => deck.colors === "C" || withinColors(identityOf([card]), deck.colors),
      );
      const exact = hits.filter((h) => h.name.toLowerCase() === c.typed_name.toLowerCase());
      const pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : undefined;
      if (pick) {
        c.scryfall_oracle_id = pick.oracle_id;
        c.card_name = pick.name;
        cards.set(c, pick);
      }
    } catch (e) {
      console.warn(`Scryfall lookup failed for ${c.typed_name}: ${(e as Error).message}`);
    }
  }
  let linked = 0;
  for (const deck of res.decks) {
    const slots = res.deckCommanders.filter((c) => c.deck_id === deck.deck_id && c.role !== "companion");
    if (slots.length === 0 || !slots.every((c) => c.scryfall_oracle_id)) continue;
    const picked = slots.map((c) => cards.get(c)).filter((x): x is ScryCard => !!x);
    // Slots linked earlier (kept from a previous run) have no card here; trust them.
    const ok = picked.length < slots.length || deck.colors === "C" || identityOf(picked) === deck.colors;
    if (ok) {
      deck.commander_status = "resolved";
      linked++;
    } else {
      console.warn(`Deck ${deck.name} (${deck.colors}): commanders' combined colors don't match; left unresolved.`);
      for (const c of slots) if (cards.has(c)) (c.scryfall_oracle_id = ""), (c.card_name = "");
    }
  }
  return linked;
}

/** Pull "name, games, wins" rows out of the old Player Statistics tab, wherever they sit. */
function oldPlayerTotals(grid: Grid, names: Map<string, string>) {
  const out = new Map<string, { games: number; wins: number }>();
  for (const row of grid) {
    for (let i = 0; i < row.length; i++) {
      const id = names.get(row[i]?.trim().toLowerCase());
      if (!id || out.has(id)) continue;
      const nums = row.slice(i + 1).map((c) => c.trim()).filter((c) => /^\d+$/.test(c)).map(Number);
      if (nums.length >= 2) out.set(id, { games: nums[0], wins: nums[1] });
      break;
    }
  }
  return out;
}

function gridToMd(grid: Grid, maxRows = 60) {
  const rows = grid.filter((r) => r.some((c) => c.trim())).slice(0, maxRows);
  if (rows.length === 0) return "_empty_\n";
  const width = Math.max(...rows.map((r) => r.length));
  const esc = (c: string) => (c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = rows.map((r) => `| ${Array.from({ length: width }, (_, i) => esc(r[i] ?? "")).join(" | ")} |`);
  lines.splice(1, 0, `|${" --- |".repeat(width)}`);
  return lines.join("\n") + "\n";
}

async function main() {
  const old = await readOld();
  if (old.games.length === 0) throw new Error("The old Games tab is empty or missing");
  const seedsFile = path.join(__dirname, "commander-seeds.json");
  const commanderSeeds = fs.existsSync(seedsFile) ? JSON.parse(fs.readFileSync(seedsFile, "utf8")) : {};
  const res = migrate(old, { commanderSeeds });
  console.log(
    `Read ${res.games.length} games, ${res.seats.length} seats, ${res.players.length} players, ${res.decks.length} decks.`,
  );
  if (!flag("--no-scryfall")) {
    console.log("Linking commanders through Scryfall (about 8 per second)…");
    console.log(`Linked ${await resolveCommanders(res)} of ${res.decks.length} decks.`);
  }

  // ---- comparison report
  const withSeats: GameWithSeats[] = res.games.map((g) => ({ ...g, seats: res.seats.filter((s) => s.game_id === g.game_id) }));
  const ours = playerStats(withSeats, { ignoredPlayers: [] });
  const nameToId = new Map(res.players.map((p) => [p.display_name.toLowerCase(), p.player_id]));
  const theirs = oldPlayerTotals(old.playerStats, nameToId);
  const display = (id: string) => res.players.find((p) => p.player_id === id)?.display_name ?? id;
  let report = `# Migration report\n\nGenerated ${new Date().toISOString()}\n\n`;
  report += `- Games: ${res.games.length}\n- Seats: ${res.seats.length}\n- Players: ${res.players.length}\n- Decks: ${res.decks.length} (${res.decks.filter((d) => d.commander_status === "unresolved").length} unresolved)\n- Win conditions: ${res.winConditions.map((w) => w.name).join(", ")}\n- Rules: ${res.rules.map((r) => r.name).join(", ")}\n\n`;
  report += `## Players: new vs old Player Statistics\n\n| Player | Games (new) | Games (old) | Wins (new) | Wins (old) | Win % (new) | Match |\n| --- | ---: | ---: | ---: | ---: | ---: | --- |\n`;
  let mismatches = 0;
  for (const s of ours) {
    const o = theirs.get(s.player_id);
    const match = !o ? "not found in old tab" : o.games === s.games && o.wins === s.wins ? "✓" : "✗";
    if (match === "✗") mismatches++;
    report += `| ${display(s.player_id)} | ${s.games} | ${o?.games ?? ""} | ${s.wins} | ${o?.wins ?? ""} | ${(s.winRate * 100).toFixed(1)}% | ${match} |\n`;
  }
  report += `\n## Seats (new)\n\n`;
  for (const t of seatStats(withSeats, { ignoredPlayers: [] })) {
    report += `**${t.podSize}-player pods** (${t.games} games)\n\n| Seat | Played | Wins | Win % |\n| --- | ---: | ---: | ---: |\n`;
    for (const s of t.seats) report += `| ${s.seat} | ${s.played} | ${s.wins} | ${(s.winRate * 100).toFixed(1)}% |\n`;
    report += "\n";
  }
  report += `## Old Turn Order Statistics (for side-by-side checking)\n\n${gridToMd(old.turnStats)}\n`;
  report += `## Old Player Statistics\n\n${gridToMd(old.playerStats)}\n`;
  report += `## Warnings (${res.warnings.length})\n\n${res.warnings.map((w) => `- ${w}`).join("\n") || "None"}\n`;
  fs.writeFileSync("migration-report.md", report);
  console.log(`Wrote migration-report.md (${mismatches} player mismatches, ${res.warnings.length} warnings).`);

  if (!flag("--write")) {
    console.log("Dry run only. Re-run with --write to write the database.");
    return;
  }

  // ---- write into Postgres, keeping anything already curated there
  const h = await openForScripts();
  try {
    const { group } = await ensureDefaultGroup(h.db);
    const merged = await importMigration(h.db, group.id, res, { force: flag("--force") });
    for (const w of merged.warnings) console.warn(w);
    console.log(
      `Wrote ${res.games.length} games${merged.appGames ? ` (kept ${merged.appGames} entered through the app)` : ""} into group "${group.name}" (${h.kind === "neon" ? "DATABASE_URL" : ".data/pglite"}).`,
    );
  } finally {
    await h.close();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
