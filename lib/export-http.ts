// Shared bits for the /admin/export route handlers.
import { getCurrentPlayer } from "./auth";
import { isAdmin } from "./permissions";
import type { Player } from "./schema";

/** The signed-in admin, or a ready-made error response. */
export async function exportActor(): Promise<{ actor: Player } | { response: Response }> {
  const actor = await getCurrentPlayer();
  if (!actor) return { response: new Response("Sign in first.", { status: 401 }) };
  if (!isAdmin(actor)) return { response: new Response("Only admins can export data.", { status: 403 }) };
  return { actor };
}

export function download(body: string, filename: string, type: string) {
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export const stamp = () => new Date().toISOString().slice(0, 10);
