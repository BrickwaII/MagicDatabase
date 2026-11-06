import Link from "next/link";
import { saveLookupAction, savePlayerAction } from "@/app/actions";
import { ShareAndExport } from "@/components/ShareAndExport";
import { requireAdmin } from "@/lib/auth";
import { listPlayers, listRules, listWinConditions } from "@/lib/data";
import type { Lookup, Player } from "@/lib/schema";

function PlayerRow({ p }: { p?: Player }) {
  return (
    <form action={savePlayerAction} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      {p && <input type="hidden" name="player_id" value={p.player_id} />}
      <input name="display_name" defaultValue={p?.display_name} placeholder="Name" required style={{ width: 140 }} />
      <input name="email" type="email" defaultValue={p?.email} placeholder="Google email" style={{ flex: 1, minWidth: 180 }} />
      <select name="role" defaultValue={p?.role ?? "player"}>
        <option value="player">Player</option>
        <option value="admin">Admin</option>
      </select>
      <label className="row small">
        <input type="checkbox" name="active" defaultChecked={p ? p.active : true} /> Active
      </label>
      <button type="submit" className={p ? "" : "primary"}>
        {p ? "Save" : "Add player"}
      </button>
    </form>
  );
}

function LookupList({ tab, title, items }: { tab: "WinConditions" | "Rules"; title: string; items: Lookup[] }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {items.map((l) => (
        <form key={l.id} action={saveLookupAction} className="row" style={{ marginBottom: 6 }}>
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="id" value={l.id} />
          <input name="name" defaultValue={l.name} required style={{ flex: 1 }} />
          <button type="submit">Rename</button>
        </form>
      ))}
      <form action={saveLookupAction} className="row" style={{ marginTop: 10 }}>
        <input type="hidden" name="tab" value={tab} />
        <input name="name" placeholder="New…" required style={{ flex: 1 }} />
        <button type="submit" className="primary">
          Add
        </button>
      </form>
    </div>
  );
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { error } = await searchParams;
  const [players, wcs, rules] = await Promise.all([listPlayers({ includeInactive: true }), listWinConditions(), listRules()]);
  return (
    <div className="stack">
      <div className="spread">
        <h1>Admin</h1>
        <Link href="/admin/audit">Audit log →</Link>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Players and invite list</h3>
        <p className="small muted">
          Anyone listed here with an email can sign in with that Google account. Admins skip the approval queue and can approve
          others&apos; games. Players without an email are tracked but can&apos;t sign in.
        </p>
        {players.map((p) => (
          <PlayerRow key={p.player_id} p={p} />
        ))}
        <PlayerRow />
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        <LookupList tab="WinConditions" title="Win conditions" items={wcs} />
        <LookupList tab="Rules" title="Additional rules" items={rules} />
      </div>
      <ShareAndExport />
    </div>
  );
}
