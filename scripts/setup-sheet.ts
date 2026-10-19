// Creates the app's tabs and header rows in SPREADSHEET_ID (or the local store).
// Optionally adds the first admin:  npm run setup-sheet -- --admin you@gmail.com "Henry"
import "./env";
import { getStore } from "../lib/store";
import { parse, serialize } from "../lib/schema";
import { slugify } from "../lib/util";

async function main() {
  const store = getStore();
  await store.ensureTabs();
  console.log("Tabs and headers are in place.");

  const i = process.argv.indexOf("--admin");
  if (i !== -1) {
    const email = (process.argv[i + 1] ?? "").toLowerCase();
    const name = process.argv[i + 2] ?? email.split("@")[0];
    if (!email.includes("@")) throw new Error("Usage: --admin you@gmail.com \"Display name\"");
    const rows = await store.getRows("Players");
    const existing = rows.find((r) => r.data.email?.toLowerCase() === email || r.data.player_id === slugify(name));
    if (existing) {
      const p = { ...parse.player(existing.data), email, role: "admin" as const, active: true };
      await store.updateRow("Players", existing.index, serialize.player(p));
      console.log(`Made ${p.display_name} (${email}) an admin.`);
    } else {
      await store.appendRows("Players", [
        serialize.player({ player_id: slugify(name), display_name: name, email, role: "admin", active: true }),
      ]);
      console.log(`Added ${name} (${email}) as admin.`);
    }
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
