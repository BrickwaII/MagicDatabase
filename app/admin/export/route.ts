import { exportGroupJson } from "@/lib/export";
import { download, exportActor, stamp } from "@/lib/export-http";

export const dynamic = "force-dynamic";

/** Full backup of the group as one JSON file. Admins only. */
export async function GET() {
  const who = await exportActor();
  if ("response" in who) return who.response;
  const data = await exportGroupJson(who.actor);
  return download(JSON.stringify(data, null, 2), `commander-tracker-backup-${stamp()}.json`, "application/json");
}
