// One-time setup, safe to rerun:
//   npm run setup -- --admin you@gmail.com "Henry" [--group "Henry's Playgroup"]
//
// Applies migrations, creates the default group if there is none (renames it
// when --group is given), and adds or promotes the first admin.
import "./env";
import { openForScripts } from "../lib/db";
import { runSetup } from "../lib/db/setup";

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

async function main() {
  const h = await openForScripts();
  try {
    const i = args.indexOf("--admin");
    const admin = i === -1 ? undefined : { email: args[i + 1] ?? "", name: args[i + 2]?.startsWith("--") ? undefined : args[i + 2] };
    const res = await runSetup(h.db, { groupName: opt("--group"), admin });
    console.log(`Database ready (${h.kind === "neon" ? "DATABASE_URL" : ".data/pglite"}).`);
    console.log(`${res.created ? "Created" : "Using"} group "${res.group.name}".`);
    if (res.admin) {
      const who = `${res.admin.name} (${res.admin.email})`;
      const msg = { created: `Added ${who} as admin.`, promoted: `Made ${who} an admin.`, unchanged: `${who} is already an admin.` };
      console.log(msg[res.admin.action]);
    } else {
      console.log('No admin given. Add one with: npm run setup -- --admin you@gmail.com "Your name"');
    }
  } finally {
    await h.close();
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
