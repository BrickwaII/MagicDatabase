# Commander Tracker

A website for our Commander group: friends sign in with Google, log games, manage decks, and see player, deck and turn-order stats. It replaces the "Magic Records - 2026" spreadsheet. Data lives in a Google Sheet that only the app's server can reach.

- **Next.js 15** (App Router, server actions) on Vercel
- **Google Sheets** as the database, through a service account
- **NextAuth** Google sign-in, limited to emails on the Players tab
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
| `/admin` | Players and invite list, admin grants, win conditions and rules; `/admin/audit` shows the change log |

### Rules built in

- A player's submission is `pending` until an admin approves it. An admin's own games are approved straight away.
- Players can edit any game they sat in. If a player edits an approved game, it goes back to the queue. If an admin edits it, it stays approved.
- Only approved games where someone won count in stats. Draws and unfinished games are saved but never counted.
- `day_game_no` is set automatically: the previous game that day plus 1.
- Each game has a `rev`. If two people edit the same game at once, the second save is refused and they're asked to reload.
- Every change is written to `AuditLog` with who, when, and the before and after values.
- Decks are keyed by owner, so two players can both have a "Tidus". Colors are stored as WUBRG letters.
- Commanders link to Scryfall oracle IDs. The second slot only offers legal pairs: Partner, Partner with, Partner—X, Friends forever, Choose a Background, and Doctor's companion. A companion can go in a separate third slot. If a card can't be found, type its name and pick colors; the deck is saved as `unresolved` and shows up in the admin queue.

## Spreadsheet layout

`npm run setup-sheet` creates these tabs. Each tab holds one record per row, with no formulas or merged cells. Don't edit the sheet by hand.

| Tab | Columns |
| --- | --- |
| Players | player_id, display_name, email, role, active |
| Decks | deck_id, owner_player_id, name, colors, bracket, notes, commander_status, active |
| DeckCommanders | deck_id, slot, role, scryfall_oracle_id, card_name, typed_name |
| Games | game_id, day_game_no, date, status, result, brackets, win_conditions, additional_rules, notes, submitted_by, approved_by, rev, reject_reason |
| GameSeats | game_id, seat, player_id, deck_id, is_winner |
| WinConditions / Rules | id, name |
| AuditLog | timestamp, user, entity, entity_id, action, before, after |

## Local development (no Google needed)

```bash
npm install
cp .env.example .env.local      # STORAGE_BACKEND=local, DEV_LOGIN=true
npm run seed                    # sample data in .data/db.json
npm run dev
```

Open http://localhost:3000 and use **Dev sign in** with `henry@example.com` (admin) or `sam@example.com` (player). Dev login is disabled whenever `NODE_ENV=production`.

```bash
npm test          # unit tests: stats, permissions/data layer, migration, Scryfall pairing
npm run typecheck
npm run build
```

## Production setup (one time)

1. **Google Cloud:** create a project and enable the **Google Sheets API**.
2. **Service account:** create one and download its JSON key. Never commit the key.
3. **New spreadsheet:** create an empty Google Sheet and share it as **Editor** with the service account's email. Its ID is the long part of the URL, `/d/<ID>/edit`.
4. **Tabs and first admin:** with `STORAGE_BACKEND=sheets`, `SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_KEY` in `.env.local`, run
   `npm run setup-sheet -- --admin your@gmail.com "Henry"`
5. **OAuth client:** in Google Cloud, go to APIs & Services → Credentials → OAuth client ID → Web application.
6. **Vercel:** import the GitHub repo and set these environment variables:
   - `STORAGE_BACKEND=sheets`
   - `SPREADSHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_KEY`: the whole JSON on one line, or base64 of it
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_SECRET`: generate with `openssl rand -base64 32`
   - `NEXTAUTH_URL`: e.g. `https://your-app.vercel.app`
   - Do **not** set `DEV_LOGIN`.
7. **Redirect URIs:** after the first deploy, add these to the OAuth client's authorized redirect URIs:
   - `https://your-app.vercel.app/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
8. Add your friends on `/admin` with their Google emails.

## Migrating the old sheet

The script reads the old sheet and never writes to it. Share the old sheet as **Viewer** with the service account and set `OLD_SPREADSHEET_ID`. Alternatively, export its tabs as CSV (`Games.csv`, `Decks.csv`, `DeckDetails.csv`, `Data.csv`, `Player Statistics.csv`, `Turn Order Statistics.csv`) and pass `--csv-dir`.

```bash
npm run migrate                      # dry run → migration-report.md
npm run migrate -- --write           # write the new spreadsheet
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

The script can be rerun until cutover. Migrated rows have stable IDs, and emails, roles and commanders already linked in the new sheet are kept. Once games have been entered through the app, it refuses to run without `--force`.

The old sheet's exact column layout wasn't available while this was written, so columns are detected by header name (date, game #, seat/turn order, player, deck, winner, bracket, win condition, rules, notes). Check the dry-run report before running `--write`.
