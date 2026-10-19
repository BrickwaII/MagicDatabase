// One-time import from the old "Magic Records - 2026" sheet into the new layout.
//
//   npm run migrate                      dry run: read, transform, write migration-report.md
//   npm run migrate -- --write           also write the new spreadsheet (SPREADSHEET_ID / local store)
//   npm run migrate -- --csv-dir ./old   read CSV exports (Games.csv, Decks.csv, ...) instead of the API
//   npm run migrate -- --no-scryfall     skip commander lookups
//
// The old sheet is only read. Rerunnable until cutover: migrated rows have
// stable ids (m_..., d_...), and players' emails/roles and commanders already
// linked in the new sheet are kept.
import "./env";
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "../lib/csv";
import { migrate, type Grid, type MigrationResult } from "../lib/migrate";
import { parse, serialize, type GameWithSeats } from "../lib/schema";
import { commanderQuery, identityOf, search } from "../lib/scryfall";
import { playerStats, seatStats } from "../lib/stats";
import { getStore } from "../lib/store";
import { SheetsStore } from "../lib/store/sheets";

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
  const old = new SheetsStore(id, key, ["https://www.googleapis.com/auth/spreadsheets.readonly"]);
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

/** Link each deck to a Scryfall card when exactly one legal commander matches its name and colors. */
async function resolveCommanders(res: MigrationResult) {
  let linked = 0;
  for (const c of res.deckCommanders) {
    if (c.scryfall_oracle_id || !c.typed_name) continue;
    const deck = res.decks.find((d) => d.deck_id === c.deck_id)!;
    await sleep(120);
    try {
      const hits = (await search(commanderQuery(c.typed_name), 50)).filter(
        (card) => deck.colors === "C" || identityOf([card]) === deck.colors,
      );
      const exact = hits.filter((h) => h.name.toLowerCase() === c.typed_name.toLowerCase());
      const pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : undefined;
      if (pick) {
        c.scryfall_oracle_id = pick.oracle_id;
        c.card_name = pick.name;
        deck.commander_status = "resolved";
        linked++;
      }
    } catch (e) {
      console.warn(`Scryfall lookup failed for ${c.typed_name}: ${(e as Error).message}`);
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
    console.log("Dry run only. Re-run with --write to write the new spreadsheet.");
    return;
  }

  // ---- write, keeping anything already curated in the new sheet
  const store = getStore();
  await store.ensureTabs();
  const current = {
    players: (await store.getRows("Players")).map((r) => parse.player(r.data)),
    decks: (await store.getRows("Decks")).map((r) => parse.deck(r.data)),
    cmds: (await store.getRows("DeckCommanders")).map((r) => parse.deckCommander(r.data)),
    games: (await store.getRows("Games")).map((r) => parse.game(r.data)),
    seats: (await store.getRows("GameSeats")).map((r) => parse.seat(r.data)),
    wcs: (await store.getRows("WinConditions")).map((r) => parse.lookup(r.data)),
    rules: (await store.getRows("Rules")).map((r) => parse.lookup(r.data)),
  };
  const appGames = current.games.filter((g) => !g.game_id.startsWith("m_"));
  if (appGames.length && !flag("--force")) {
    throw new Error(
      `The new sheet already has ${appGames.length} games entered through the app. Re-run with --force to keep them and re-import the rest.`,
    );
  }

  const players = res.players.map((p) => current.players.find((c) => c.player_id === p.player_id) ?? p);
  players.push(...current.players.filter((c) => !players.some((p) => p.player_id === c.player_id)));

  const decks = res.decks.map((d) => {
    const c = current.decks.find((x) => x.deck_id === d.deck_id);
    return c ? { ...d, commander_status: c.commander_status, bracket: c.bracket || d.bracket, notes: c.notes || d.notes, active: c.active } : d;
  });
  decks.push(...current.decks.filter((c) => !decks.some((d) => d.deck_id === c.deck_id)));

  // Commanders: keep the new sheet's links for decks it already has.
  const curatedDecks = new Set(current.cmds.filter((c) => c.scryfall_oracle_id).map((c) => c.deck_id));
  const cmds = [
    ...res.deckCommanders.filter((c) => !curatedDecks.has(c.deck_id)),
    ...current.cmds.filter((c) => curatedDecks.has(c.deck_id) || !res.decks.some((d) => d.deck_id === c.deck_id)),
  ];
  for (const d of decks) if (curatedDecks.has(d.deck_id)) d.commander_status = current.decks.find((x) => x.deck_id === d.deck_id)?.commander_status ?? d.commander_status;

  const mergeLookups = (a: typeof res.rules, b: typeof res.rules) => [...b, ...a.filter((x) => !b.some((y) => y.id === x.id))];

  await store.replaceAll("Players", players.map(serialize.player));
  await store.replaceAll("Decks", decks.map(serialize.deck));
  await store.replaceAll("DeckCommanders", cmds.map(serialize.deckCommander));
  await store.replaceAll("WinConditions", mergeLookups(res.winConditions, current.wcs).map(serialize.lookup));
  await store.replaceAll("Rules", mergeLookups(res.rules, current.rules).map(serialize.lookup));
  await store.replaceAll("Games", [...res.games, ...appGames].map(serialize.game));
  await store.replaceAll(
    "GameSeats",
    [...res.seats, ...current.seats.filter((s) => appGames.some((g) => g.game_id === s.game_id))].map(serialize.seat),
  );
  await store.appendRows("AuditLog", [
    {
      timestamp: new Date().toISOString(),
      user: "import",
      entity: "migration",
      entity_id: "",
      action: "import",
      before: "",
      after: JSON.stringify({ games: res.games.length, decks: res.decks.length, players: res.players.length }),
    },
  ]);
  console.log("Wrote the new spreadsheet.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
