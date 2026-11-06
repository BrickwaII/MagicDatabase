import Link from "next/link";
import { saveLookupAction, savePlayerAction } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { listPlayers, listRules, listWinConditions } from "@/lib/data";
import type { Lookup, Player } from "@/lib/schema";

function PlayerRow({ p }: { p?: Player }) {
  return (
    <form action={savePlayerAction} className="admin-row">
      {p && <input type="hidden" name="player_id" value={p.player_id} />}
      <input name="display_name" defaultValue={p?.display_name} placeholder="Name" aria-label="Name" required />
      <input name="email" type="email" inputMode="email" autoComplete="off" defaultValue={p?.email} placeholder="Google email" aria-label="Google email" />
      <select name="role" defaultValue={p?.role ?? "player"} aria-label="Role">
        <option value="player">Player</option>
        <option value="admin">Admin</option>
      </select>
      <label className="check small">
        <input type="checkbox" name="active" defaultChecked={p ? p.active : true} /> Active
      </label>
      <SubmitButton className={p ? "" : "primary"} pendingText="Saving…">
        {p ? "Save" : "Add player"}
      </SubmitButton>
    </form>
  );
}

function LookupList({ tab, title, items }: { tab: "WinConditions" | "Rules"; title: string; items: Lookup[] }) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {items.map((l) => (
        <form key={l.id} action={saveLookupAction} className="lookup-row">
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="id" value={l.id} />
          <input name="name" defaultValue={l.name} aria-label={`Rename ${l.name}`} required />
          <SubmitButton pendingText="Saving…">Rename</SubmitButton>
        </form>
      ))}
      <form action={saveLookupAction} className="lookup-row" style={{ marginTop: 14 }}>
        <input type="hidden" name="tab" value={tab} />
        <input name="name" placeholder="Add a new one" aria-label={`New ${title.toLowerCase()}`} required />
        <SubmitButton className="primary" pendingText="Adding…">
          Add
        </SubmitButton>
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
      <div className="page-head">
        <h1>Admin</h1>
        <Link className="btn" href="/admin/audit">
          Audit log
        </Link>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Players and invite list</h2>
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
    </div>
  );
}
