// Apply the SQL migrations in drizzle/ to the configured database:
// Neon when DATABASE_URL (or DATABASE_URL_UNPOOLED) is set, otherwise the local
// PGlite database in .data/pglite. Already-applied migrations are skipped.
import "./env";
import { openForScripts } from "../lib/db";

async function main() {
  const h = await openForScripts();
  console.log(`Migrations applied (${h.kind === "neon" ? "Postgres at DATABASE_URL" : "local PGlite in .data/pglite"}).`);
  await h.close();
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
