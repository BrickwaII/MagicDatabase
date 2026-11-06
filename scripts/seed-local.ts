// Fills the local database with sample data for development. Replaces the
// default group's players, decks, lookups and games each time it runs.
// Sign in with DEV_LOGIN=true as henry@example.com (admin) or sam@example.com.
import "./env";
import { openForScripts } from "../lib/db";
import { ensureDefaultGroup } from "../lib/db/group";
import { replaceGroupData } from "../lib/db/import";
import type { Game, GameSeat } from "../lib/schema";

async function main() {
  if (process.env.DATABASE_URL && !process.argv.includes("--yes")) {
    throw new Error("DATABASE_URL is set, so this would overwrite that database. Unset it to seed local PGlite, or pass --yes.");
  }
  const players = [
    { player_id: "henry", display_name: "Henry", email: "henry@example.com", role: "admin" as const, active: true },
    { player_id: "sam", display_name: "Sam", email: "sam@example.com", role: "player" as const, active: true },
    { player_id: "alex", display_name: "Alex", email: "alex@example.com", role: "player" as const, active: true },
    { player_id: "jordan", display_name: "Jordan", email: "", role: "player" as const, active: true },
  ];
  const decks = [
    ["d_henry_tifa", "henry", "Tifa", "WRG"],
    ["d_henry_tidus", "henry", "Tidus", "WU"],
    ["d_sam_tidus", "sam", "Tidus", "WU"],
    ["d_sam_emmara", "sam", "Emmara", "WG"],
    ["d_alex_kilo", "alex", "Kilo", "UG"],
    ["d_alex_bumbleflower", "alex", "Bumbleflower", "WG"],
    ["d_jordan_temur", "jordan", "Temur Partners", "URG"],
  ].map(([deck_id, owner_player_id, name, colors]) => ({
    deck_id,
    owner_player_id,
    name,
    colors,
    bracket: "3",
    notes: "",
    commander_status: "unresolved" as const,
    active: true,
  }));
  const wcs = [
    ["combat", "Combat"],
    ["commander-damage", "Commander damage"],
    ["combo", "Combo"],
    ["alt-win", "Alternate win"],
    ["mill", "Mill"],
  ].map(([id, name]) => ({ id, name }));
  const rules = [
    ["planechase", "Planechase"],
    ["archenemy", "Archenemy"],
    ["bounty", "Bounty"],
  ].map(([id, name]) => ({ id, name }));

  const games: Game[] = [];
  const seats: GameSeat[] = [];
  const pods: [string, string][][] = [
    [["henry", "d_henry_tifa"], ["sam", "d_sam_tidus"], ["alex", "d_alex_kilo"], ["jordan", "d_jordan_temur"]],
    [["sam", "d_sam_emmara"], ["alex", "d_alex_bumbleflower"], ["henry", "d_henry_tidus"]],
    [["alex", "d_alex_kilo"], ["jordan", "d_jordan_temur"], ["henry", "d_henry_tifa"], ["sam", "d_sam_tidus"], ["RANDOM", ""]],
  ];
  for (let day = 0; day < 12; day++) {
    const date = `2026-0${1 + Math.floor(day / 4)}-${String(3 + (day % 4) * 7).padStart(2, "0")}`;
    for (let n = 1; n <= 2; n++) {
      const pod = pods[(day + n) % pods.length];
      const id = `g_seed_${day}_${n}`;
      const winner = (day * 3 + n) % pod.length;
      games.push({
        game_id: id,
        day_game_no: n,
        date,
        status: day === 11 && n === 2 ? "pending" : "approved",
        result: day === 5 && n === 2 ? "draw" : "won",
        brackets: ["3"],
        win_conditions: day === 5 && n === 2 ? [] : [wcs[(day + n) % wcs.length].id],
        additional_rules: day % 5 === 0 ? ["planechase"] : [],
        notes: "",
        submitted_by: "henry",
        approved_by: day === 11 && n === 2 ? "" : "henry",
        rev: 1,
        reject_reason: "",
      });
      pod.forEach(([player_id, deck_id], i) =>
        seats.push({ game_id: id, seat: i + 1, player_id, deck_id, is_winner: !(day === 5 && n === 2) && i === winner }),
      );
    }
  }

  const h = await openForScripts();
  try {
    const { group } = await ensureDefaultGroup(h.db);
    await h.db.transaction((tx) =>
      replaceGroupData(tx, group.id, {
        players,
        decks,
        deckCommanders: decks.map((d) => ({
          deck_id: d.deck_id,
          slot: 1,
          role: "commander",
          scryfall_oracle_id: "",
          card_name: "",
          typed_name: d.name,
        })),
        winConditions: wcs,
        rules,
        games,
        seats,
      }),
    );
    const where = h.kind === "neon" ? "DATABASE_URL" : ".data/pglite";
    console.log(`Seeded ${players.length} players, ${decks.length} decks, ${games.length} games into "${group.name}" (${where}).`);
  } finally {
    await h.close();
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
