import { CSV_EXPORTS, exportCsv, type CsvExport } from "@/lib/export";
import { download, exportActor, stamp } from "@/lib/export-http";

export const dynamic = "force-dynamic";

/** /admin/export/games-flat.csv, /admin/export/players.csv, /admin/export/decks.csv, /admin/export/deck-versions.csv. Admins only. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const entity = file.replace(/\.csv$/, "") as CsvExport;
  if (!file.endsWith(".csv") || !CSV_EXPORTS.includes(entity)) return new Response("Not found", { status: 404 });
  const who = await exportActor();
  if ("response" in who) return who.response;
  // Byte-order mark so Excel opens the file as UTF-8.
  const csv = "﻿" + (await exportCsv(entity, who.actor));
  return download(csv, `${entity}-${stamp()}.csv`, "text/csv");
}
