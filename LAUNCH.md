# Launch checklist

Everything here is one-time clicking and pasting. The code, database schema, migrations and import are already written. Expect about 30–45 minutes, most of it in Google Cloud.

You need: a GitHub login (this repo), a Google account, and Node 20+ on your computer for the two commands in step 6.

---

## 1. Google sign-in client (≈10 min)

Players sign in with Google. You need one OAuth client.

1. Go to <https://console.cloud.google.com/> → create a project (e.g. "commander-tracker").
2. **APIs & Services → OAuth consent screen**
   - User type: **External**. App name: whatever you'll call the site. Support email: yours.
   - Scopes: leave the defaults (only email, profile, openid, which need no Google review).
   - Under **Audience / Publishing status**, click **Publish app** so friends can sign in without being added as test users.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: add `http://localhost:3000/api/auth/callback/google` now. You'll add the live one in step 5.
4. Keep the **Client ID** and **Client secret** handy.

## 2. Vercel project (≈5 min)

1. Sign in at <https://vercel.com> with GitHub (free Hobby plan).
2. **Add New → Project → Import** `BrickwaII/MagicDatabase`. Framework is detected as Next.js; leave the build settings alone (the repo's `vercel-build` script runs database migrations, then builds).
3. Deploy. **The first build is expected to fail** with "DATABASE_URL is not set". That's fine; step 3 fixes it.
4. Note your site address, e.g. `https://magicdatabase.vercel.app` (Project → Settings → Domains). You can rename it there to something nicer.

## 3. Database (≈3 min)

1. In the Vercel project: **Storage → Create → Neon** (Postgres). Pick the Free plan and a region near you (e.g. US West).
2. Connect it to the project for **Production** (and **Preview** if you like; tick "Create database branch for deployment → Preview" so preview deploys never touch real data).
3. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for you. Nothing to paste. (If the connect dialog offers an environment-variable prefix, leave it empty; the app looks for exactly these names.)

## 4. Environment variables (≈3 min)

Vercel project → **Settings → Environment Variables**, for Production (and Preview):

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | from step 1 |
| `GOOGLE_CLIENT_SECRET` | from step 1 |
| `NEXTAUTH_SECRET` | a long random string, e.g. from `openssl rand -base64 32` or any password generator |
| `NEXTAUTH_URL` | your site address from step 2, e.g. `https://magicdatabase.vercel.app` |

Do **not** set `DEV_LOGIN`.

Then **Deployments → ⋯ → Redeploy**. This build applies the database schema and should go green.

## 5. Finish the sign-in client (≈1 min)

Back in Google Cloud → Credentials → your OAuth client → Authorized redirect URIs, add:

`https://<your-site>/api/auth/callback/google`

(If you later add a custom domain, add its callback URL too and update `NEXTAUTH_URL`.)

## 6. Create your group, then import the old sheet (≈10 min)

On your computer:

```bash
git clone https://github.com/BrickwaII/MagicDatabase.git && cd MagicDatabase
npm install
npx vercel link            # pick the project you just made
npx vercel env pull .env.local --environment=production   # brings down the live DATABASE_URL etc.
npm run setup -- --admin you@gmail.com "Henry"
```

That creates "Henry's Playgroup" and makes your Google email the first admin. Safe to rerun.

Check that setup printed **`Database ready (DATABASE_URL)`**. If it says `.data/pglite` instead, the pull didn't bring down the database URL (without `--environment=production` it pulls the Development variables, which the Neon connection from step 3 may not include) and nothing reached the live site: fix the pull and run setup again. Use the same name as your column in the old sheet ("Henry") so the import matches you to your games.

While this `.env.local` is in place, every command in this folder talks to the live database. Don't use it for `npm run dev`; delete it (or copy `.env.example` back over it) when you're done with this step.

**Import the old games.** Easiest route, no extra Google setup: in "Magic Records - 2026", use **File → Download → Comma-separated values** on each of these tabs and put the files in a folder named `old/` inside the repo folder, named exactly:
`Games.csv`, `Decks.csv`, `DeckDetails.csv`, `Data.csv`, `Player Statistics.csv`, `Turn Order Statistics.csv`.

```bash
npm run migrate -- --csv-dir ./old            # dry run: writes migration-report.md, changes nothing
# read migration-report.md: per-player totals vs the old sheet
npm run migrate -- --csv-dir ./old --write    # import for real; the last line should end in "(DATABASE_URL)."
```

The import was already checked against a copy of your sheet from November 2026: under the old sheet's own filters, 17 of 19 players match exactly and the other two differ only where old rows were broken. Do this step on the day you switch over. If games get logged in the old sheet afterwards, rerun it until your first game is entered in the app; after that it refuses without `--force`.

`old/`, `.env.local` and `migration-report.md` are git-ignored, so none of this lands in the public repo.

## 7. Invite people (≈5 min)

1. Open your site, sign in with Google.
2. **Admin → Players and invite list**: add each friend's Google email to their (already imported) player. Only emails on this list can sign in.
3. **Queue**: about 100 imported decks couldn't be matched to a commander automatically; link them there over time (it doesn't affect stats).
4. Optional, on **Admin → Public stats link**: turn on the public stats link and send it around. It shows stats and recent games only, no emails or notes, and you can regenerate it anytime.

Send friends the site address. On a phone, "Add to Home Screen" gives it an app icon.

---

### If something goes wrong

- **Build fails with DATABASE_URL missing:** step 3 isn't connected to the Production environment.
- **"Error 400: redirect_uri_mismatch" at sign-in:** the callback URL in step 5 doesn't exactly match your site address (check `https`, no trailing slash).
- **"That Google account isn't on the invite list":** add that email to the player on Admin → Players and invite list.
- **Sign-in loops back to the login page:** `NEXTAUTH_URL` doesn't match the address you're visiting, or `NEXTAUTH_SECRET` is missing.
- **Backups:** Admin → Export and backup → "Full backup (JSON)" saves everything as one file. Neon also keeps its own point-in-time history.
