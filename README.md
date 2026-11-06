# Commander Tracker

A website for our Commander group: friends sign in with Google, log games, manage decks, and see player, deck and turn-order stats. It replaces the "Magic Records - 2026" spreadsheet. Data lives in Postgres.

- **Next.js 15** (App Router, server actions) on Vercel
- **Postgres** through Drizzle ORM: [Neon](https://neon.tech) in production, in-process [PGlite](https://pglite.dev) locally
- **NextAuth** Google sign-in, limited to emails in the players table
- **Scryfall** commander lookup from the browser (free, no API key)

## What's in it

| Page | What it does |
| --- | --- |
| `/games/new` | Log a game: 3–6 seats in turn order, guests (untracked), borrowed decks, shared wins, draws and unfinished games, brackets, win conditions, extra rules, notes |
| `/games` | Search games by date range, player and status |
| `/games/:id` | View a game; edit it if you played in it (or you're an admin) |
| `/queue` | Admin: approve or reject pending games (rejecting needs a reason); decks still waiting to be linked to a real card |
| `/decks` | Decks per owner with records; add or edit your own |
| `/stats` | Player, deck and turn-order stats with filters for pod size, bracket, ignored rules and hidden players (Guest hidden by default) |
| `/admin` | Players and invite list, admin grants, win conditions and rules, public stats link, export; `/admin/audit` shows the change log |
| `/s/:token` | Public, read-only stats and the last 20 approved games for one group, no sign-in. Admins turn it on, copy or regenerate the link on `/admin`. Never shows emails, notes, pending or rejected games |
| `/admin/export` | Admin: full JSON backup of the group (emails, notes and audit log included). `/admin/export/games-flat.csv` (one row per seat, like the old sheet), `players.csv` and `decks.csv` |

### Rules built in

- A player's submission is `pending` until an admin approves it. An admin's own games are approved straight away.
- Players can edit any game they sat in. If a player edits an approved game, it goes back to the queue. If an admin edits it, it stays approved.
- Only approved games where someone won count in stats. Draws and unfinished games are saved but never counted.
- `day_game_no` is set automatically: the previous game that day plus 1.
- Each game has a `rev`. If two people edit the same game at once, the second save is refused and they're asked to reload.
- Every change is written to `audit_log` with who, when, and the before and after values.
- Decks are keyed by owner, so two players can both have a "Tidus". Colors are stored as WUBRG letters.
- Commanders link to Scryfall oracle IDs. The second slot only offers legal pairs: Partner, Partner with, Partner—X, Friends forever, Choose a Background, and Doctor's companion. A companion can go in a separate third slot. If a card can't be found, type its name and pick colors; the deck is saved as `unresolved` and shows up in the admin queue.

## Storage

Data lives in Postgres. `lib/db/index.ts` is the only place that picks the driver:

- `DATABASE_URL` set → Neon, through `@neondatabase/serverless` (WebSocket pool, so transactions work)
- `DATABASE_URL` unset → PGlite, an in-process Postgres stored in `.data/pglite` (gitignored). No account or server needed.

The tables are defined in `lib/db/schema.ts`. SQL migrations generated from it are committed in `drizzle/`.

| Table | What it holds |
| --- | --- |
| groups | id, name, created_at, public_stats_enabled, share_token |
| players | id (slug, e.g. `henry`), display_name, email (unique per group), role, active |
| decks | id, owner_player_id, name, colors (WUBRG letters), bracket (1–5 or null), notes, commander_status, active |
| deck_commanders | deck_id, slot (1–2 commanders, 3 companion), role, scryfall_oracle_id, card_name, typed_name |
| games | id, day_game_no (unique per group and date), date, status, result, brackets (smallint[]), notes, submitted_by, approved_by, rev, reject_reason |
| game_seats | game_id, seat, player_id, deck_id, is_winner. A guest seat has a null player and deck; the app shows it as `RANDOM`. |
| game_win_conditions, game_rules | game_id, win condition or rule id, position |
| win_conditions, rules | id, name |
| audit_log | at, actor, entity, entity_id, action, before / after (jsonb) |

Every table except `groups` has a `group_id`, and every query filters on it. For now the app has one group: the current group is the oldest one (`lib/db/group.ts`). Game edits and status changes run in a transaction that locks the row, and the update still checks `rev`. A save based on an old `rev` is refused.

After changing `lib/db/schema.ts`, run `npm run db:generate` and commit the new file in `drizzle/`. `npm run db:migrate` applies pending migrations to whichever database is configured. Migrations that have already been applied are skipped, so it's safe to rerun.

## Local development (no Google or database account needed)

```bash
npm install
cp .env.example .env.local      # DATABASE_URL unset → PGlite; DEV_LOGIN=true
npm run seed                    # migrations + sample data in .data/pglite
npm run dev
```

Open http://localhost:3000 and use **Dev sign in** with `henry@example.com` (admin) or `sam@example.com` (player). Dev login is disabled whenever `NODE_ENV=production`. `npm run dev` applies migrations to PGlite on first use. PGlite allows one process at a time, so stop `npm run dev` before running `npm run seed`, `setup` or `migrate`. Delete `.data/pglite` to start over.

```bash
npm test          # unit tests (in-memory PGlite per file): data layer, rev conflicts, group scoping, setup, migration, stats, Scryfall
npm run typecheck
npm run build
```

## Production setup (one time)

1. **Vercel project:** import the GitHub repo.
2. **Database:** in the Vercel project, open Storage → add **Neon** (Postgres). The integration sets `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`) for you. Without the integration, create a Neon project yourself and paste its connection string as `DATABASE_URL`.
3. **Schema:** nothing to do by hand. On Vercel the `vercel-build` script runs `npm run db:migrate && next build`, so every deploy applies pending migrations before building. The build fails with a clear message if `DATABASE_URL` is missing. Preview deploys migrate whichever database their `DATABASE_URL` points at, so give previews their own Neon branch (the integration can do this) if you don't want them touching production.
4. **Group and first admin:** with the production `DATABASE_URL` in `.env.local` (`vercel env pull .env.local` does this), run
   `npm run setup -- --admin your@gmail.com "Henry"`
   This applies migrations, creates the group ("Henry's Playgroup" unless you pass `--group "Name"`), and adds or promotes the admin. It's safe to run again.
5. **OAuth client:** in Google Cloud, go to APIs & Services → Credentials → OAuth client ID → Web application.
6. **Vercel environment variables:**
   - `DATABASE_URL`: set by the Neon integration
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_SECRET`: generate with `openssl rand -base64 32`
   - `NEXTAUTH_URL`: e.g. `https://your-app.vercel.app`
   - Do **not** set `DEV_LOGIN`.
7. **Redirect URIs:** after the first deploy, add these to the OAuth client's authorized redirect URIs:
   - `https://your-app.vercel.app/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
8. Add your friends on `/admin` with their Google emails.

## Migrating the old sheet

The script reads the old sheet and never writes to it. It writes into Postgres: the database at `DATABASE_URL`, or local PGlite when that's unset. It imports into the default group and creates that group if there isn't one yet. Run `npm run setup -- --admin …` before or after; either order works.

To read the sheet through the API, create a Google Cloud service account with the Sheets API enabled. Share the old sheet as **Viewer** with the service account's email, then set `OLD_SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_KEY` (the JSON key on one line, or base64 of it). These two variables are only used here, never by the app. Alternatively, export the tabs as CSV (`Games.csv`, `Decks.csv`, `DeckDetails.csv`, `Data.csv`, `Player Statistics.csv`, `Turn Order Statistics.csv`) and pass `--csv-dir`.

```bash
npm run migrate                      # dry run → migration-report.md
npm run migrate -- --write           # write into the database
npm run migrate -- --write --force   # keep games entered through the app, re-import the rest
npm run migrate -- --csv-dir ./old   # read CSV exports instead of the API
npm run migrate -- --no-scryfall     # skip commander lookups
```

What it does:

- Builds Players from the Decks header row and the Data tab.
- Splits deck cells like `🟥🟩⬜Tifa` into colors and a name.
- Fills down merged cells and groups rows into games and seats.
- Marks every game approved with result `won`.
- Turns multi-value cells into ID lists and fixes "Planeschase".
- Links commanders when Scryfall returns exactly one legal commander with matching colors. You can add known mappings to `scripts/commander-seeds.json`.
- Writes `migration-report.md`, which compares games and wins per player with the old Player Statistics tab and includes the old Turn Order tab for side-by-side checking.

The script can be rerun until cutover. Migrated rows have stable IDs, and emails, roles and commanders already linked in the database are kept. Each `--write` replaces the group's data in one transaction, so a failed run changes nothing. The audit log is kept. Once games have been entered through the app, it refuses to run without `--force`. With `--force` those games are kept; if a migrated game now has the same date and number, the app game is renumbered and a warning is printed. Parsing is in `lib/migrate.ts` and the database writes are in `lib/db/import.ts`.

The parser was checked against the real "Magic Records - 2026" sheet (Nov 2026): with the old sheet's own filters, 17 of 19 players match its Player Statistics exactly, and the other two differ only where the old sheet had bad rows (a game with deck-only rows, and a game with no recorded winner). Blank brackets carry forward from the previous game. Commander seeds in `scripts/commander-seeds.json` cover about 135 of 237 decks; the rest show up on `/queue` to link by hand. Always check the dry-run report before running `--write`.
