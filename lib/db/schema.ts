// Postgres tables (Drizzle). Every domain table carries group_id and uses a
// composite primary key (group_id, id), so slug ids like "henry" or migrated
// ids like "m_2026-01-03_01" stay readable and can repeat across groups.
//
// After changing this file run `npm run db:generate` and commit the new SQL in drizzle/.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("player_role", ["player", "admin"]);
export const gameStatusEnum = pgEnum("game_status", ["pending", "approved", "rejected"]);
export const gameResultEnum = pgEnum("game_result", ["won", "draw", "unfinished"]);
export const commanderStatusEnum = pgEnum("commander_status", ["resolved", "unresolved", "none"]);
export const commanderRoleEnum = pgEnum("commander_role", ["commander", "partner", "companion"]);

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publicStatsEnabled: boolean("public_stats_enabled").notNull().default(false),
  shareToken: text("share_token").unique(),
});

const groupId = () =>
  text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" });

export const players = pgTable(
  "players",
  {
    groupId: groupId(),
    id: text("id").notNull(),
    displayName: text("display_name").notNull(),
    /** Lower-cased; null when the player has no sign-in. */
    email: text("email"),
    role: roleEnum("role").notNull().default("player"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.id] }), unique("players_group_email_unique").on(t.groupId, t.email)],
);

export const decks = pgTable(
  "decks",
  {
    groupId: groupId(),
    id: text("id").notNull(),
    ownerPlayerId: text("owner_player_id").notNull(),
    name: text("name").notNull(),
    /** Color identity letters in WUBRG order, or "C". */
    colors: text("colors").notNull().default("C"),
    bracket: smallint("bracket"),
    notes: text("notes").notNull().default(""),
    commanderStatus: commanderStatusEnum("commander_status").notNull().default("none"),
    active: boolean("active").notNull().default(true),
    /** Optional link to the deck list (Moxfield, Archidekt, any http(s) site). */
    listUrl: text("list_url"),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.id] }),
    foreignKey({ columns: [t.groupId, t.ownerPlayerId], foreignColumns: [players.groupId, players.id] }).onUpdate("cascade"),
    index("decks_owner_idx").on(t.groupId, t.ownerPlayerId),
    check("decks_bracket_check", sql`${t.bracket} between 1 and 5`),
  ],
);

/**
 * Changes to a deck over time. Version 1 is implicit (no row): every deck starts
 * as v1, and each row here starts a new version (2, 3, …) on `started_on`. A
 * game uses the latest version whose started_on is on or before the game's
 * date, so a game played the day of a change counts toward the new version.
 * version_no always follows started_on order (renumbered on every change).
 */
export const deckVersions = pgTable(
  "deck_versions",
  {
    groupId: groupId(),
    id: text("id").notNull(),
    deckId: text("deck_id").notNull(),
    versionNo: integer("version_no").notNull(),
    startedOn: date("started_on", { mode: "string" }).notNull(),
    /** What changed, e.g. "Cut 6 removal, added Rhystic Study". */
    note: text("note").notNull().default(""),
    /** The deck list as of this version (any http(s) site), if given. */
    listUrl: text("list_url"),
    /** Player id of whoever logged the change. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.id] }),
    unique("deck_versions_deck_no_unique").on(t.groupId, t.deckId, t.versionNo),
    unique("deck_versions_deck_date_unique").on(t.groupId, t.deckId, t.startedOn),
    foreignKey({ columns: [t.groupId, t.deckId], foreignColumns: [decks.groupId, decks.id] })
      .onDelete("cascade")
      .onUpdate("cascade"),
    check("deck_versions_no_check", sql`${t.versionNo} >= 2`),
  ],
);

export const deckCommanders = pgTable(
  "deck_commanders",
  {
    groupId: groupId(),
    deckId: text("deck_id").notNull(),
    slot: smallint("slot").notNull(),
    role: commanderRoleEnum("role").notNull(),
    scryfallOracleId: text("scryfall_oracle_id"),
    cardName: text("card_name").notNull().default(""),
    typedName: text("typed_name").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.deckId, t.slot] }),
    foreignKey({ columns: [t.groupId, t.deckId], foreignColumns: [decks.groupId, decks.id] }).onDelete("cascade"),
    check("deck_commanders_slot_check", sql`${t.slot} between 1 and 3`),
  ],
);

export const winConditions = pgTable(
  "win_conditions",
  {
    groupId: groupId(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    /** Display order (insertion order). */
    seq: integer("seq").notNull().generatedByDefaultAsIdentity(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.id] })],
);

export const rules = pgTable(
  "rules",
  {
    groupId: groupId(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    /** Display order (insertion order). */
    seq: integer("seq").notNull().generatedByDefaultAsIdentity(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.id] })],
);

export const games = pgTable(
  "games",
  {
    groupId: groupId(),
    id: text("id").notNull(),
    dayGameNo: integer("day_game_no").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    status: gameStatusEnum("status").notNull().default("pending"),
    result: gameResultEnum("result").notNull().default("won"),
    brackets: smallint("brackets").array().notNull().default(sql`'{}'::smallint[]`),
    notes: text("notes").notNull().default(""),
    /** A player id, or "import" for migrated games. */
    submittedBy: text("submitted_by").notNull(),
    approvedBy: text("approved_by"),
    rev: integer("rev").notNull().default(1),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.id] }),
    unique("games_group_date_no_unique").on(t.groupId, t.date, t.dayGameNo),
    index("games_group_status_idx").on(t.groupId, t.status),
  ],
);

export const gameSeats = pgTable(
  "game_seats",
  {
    groupId: groupId(),
    gameId: text("game_id").notNull(),
    seat: smallint("seat").notNull(),
    /** Null for a guest (RANDOM in the app). */
    playerId: text("player_id"),
    /** Null for a guest. */
    deckId: text("deck_id"),
    isWinner: boolean("is_winner").notNull().default(false),
    // Guest seats only (player_id null). Kept so a guest who joins later can
    // claim the games they played: guests can share names, so the deck they
    // used and who brought them help tell them apart.
    /** What the guest is called, e.g. "Quinn". */
    guestName: text("guest_name"),
    /** Free-text commander or deck nickname the guest played. */
    guestDeck: text("guest_deck"),
    /** The player in this group who brought or added the guest. */
    guestAddedBy: text("guest_added_by"),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.gameId, t.seat] }),
    foreignKey({ columns: [t.groupId, t.gameId], foreignColumns: [games.groupId, games.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.groupId, t.playerId], foreignColumns: [players.groupId, players.id] }).onUpdate("cascade"),
    foreignKey({ columns: [t.groupId, t.deckId], foreignColumns: [decks.groupId, decks.id] }).onUpdate("cascade"),
    // Composite, so the guest's host is always a player of the same group. A
    // null guest_added_by skips the check (MATCH SIMPLE).
    foreignKey({
      name: "game_seats_guest_added_by_fk",
      columns: [t.groupId, t.guestAddedBy],
      foreignColumns: [players.groupId, players.id],
    }).onUpdate("cascade"),
    check(
      "game_seats_guest_fields_check",
      sql`${t.playerId} is null or (${t.guestName} is null and ${t.guestDeck} is null and ${t.guestAddedBy} is null)`,
    ),
    index("game_seats_player_idx").on(t.groupId, t.playerId),
    index("game_seats_deck_idx").on(t.groupId, t.deckId),
  ],
);

export const gameWinConditions = pgTable(
  "game_win_conditions",
  {
    groupId: groupId(),
    gameId: text("game_id").notNull(),
    winConditionId: text("win_condition_id").notNull(),
    position: smallint("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.gameId, t.winConditionId] }),
    foreignKey({ columns: [t.groupId, t.gameId], foreignColumns: [games.groupId, games.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.groupId, t.winConditionId], foreignColumns: [winConditions.groupId, winConditions.id] }),
  ],
);

export const gameRules = pgTable(
  "game_rules",
  {
    groupId: groupId(),
    gameId: text("game_id").notNull(),
    ruleId: text("rule_id").notNull(),
    position: smallint("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.gameId, t.ruleId] }),
    foreignKey({ columns: [t.groupId, t.gameId], foreignColumns: [games.groupId, games.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.groupId, t.ruleId], foreignColumns: [rules.groupId, rules.id] }),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    groupId: groupId(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Player id of whoever made the change, or "import". */
    actor: text("actor").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull().default(""),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [index("audit_log_group_at_idx").on(t.groupId, t.at)],
);
