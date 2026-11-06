import { regenerateShareLinkAction, setPublicStatsAction } from "@/app/share-actions";
import { requireAdmin } from "@/lib/auth";
import { getShareSettings } from "@/lib/share";
import { CopyShareLink } from "./CopyShareLink";

/** Admin page sections: public stats link and data export. */
export async function ShareAndExport() {
  const actor = await requireAdmin();
  const share = await getShareSettings(actor);
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
      <div className="card stack" id="share">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Public stats link</h3>
          <span className={`badge ${share.enabled ? "approved" : ""}`}>{share.enabled ? "On" : "Off"}</span>
        </div>
        <p className="small muted">
          Anyone with the link can see player, deck and turn-order stats and the last 20 approved games, without signing in.
          It never shows emails, notes, or pending or rejected games.
        </p>
        {share.enabled && share.token && <CopyShareLink path={`/s/${share.token}`} />}
        <div className="row">
          <form action={setPublicStatsAction}>
            <input type="hidden" name="enabled" value={share.enabled ? "off" : "on"} />
            <button type="submit" className={share.enabled ? "" : "primary"}>
              {share.enabled ? "Turn off public link" : "Turn on public link"}
            </button>
          </form>
          {share.token && (
            <form action={regenerateShareLinkAction}>
              <button type="submit">Regenerate link</button>
            </form>
          )}
        </div>
        {share.token && <p className="small muted">Regenerating makes a new link; the old one stops working straight away.</p>}
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Export and backup</h3>
        <p className="small muted">
          Full backup of everything in the group (players with emails, decks, games, lookups and the audit log), or one
          spreadsheet-friendly CSV per table.
        </p>
        <div className="row">
          <a className="btn primary" href="/admin/export" download>
            Full backup (JSON)
          </a>
        </div>
        <div className="row">
          <a className="btn" href="/admin/export/games-flat.csv" download>
            Games CSV
          </a>
          <a className="btn" href="/admin/export/players.csv" download>
            Players CSV
          </a>
          <a className="btn" href="/admin/export/decks.csv" download>
            Decks CSV
          </a>
        </div>
        <p className="small muted">The games CSV has one row per seat, laid out like the old sheet.</p>
      </div>
    </div>
  );
}
