"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { removeDeckVersion, saveDeckVersion } from "@/app/actions";
import { LIST_URL_MAX, VERSION_NOTE_MAX } from "@/lib/schema";

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  deckId: string;
  /** Editing an existing change; omitted when logging a new one. */
  version?: { id: string; started_on: string; note: string; list_url: string };
}

/** "Log a change" on a deck, or edit/delete one already logged. */
export function DeckVersionForm({ deckId, version }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [date, setDate] = useState(version?.started_on ?? "");
  const [note, setNote] = useState(version?.note ?? "");
  const [listUrl, setListUrl] = useState(version?.list_url ?? "");

  useEffect(() => {
    if (!date) setDate(localToday());
  }, [date]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await saveDeckVersion({ deckId, id: version?.id, input: { started_on: date, note, list_url: listUrl } });
      if (!res.ok) return setError(res.error);
      if (!version) {
        setNote("");
        setListUrl("");
      }
      router.refresh();
    });
  }

  function remove() {
    if (!version || !confirm("Delete this change? Its games count toward the version before it.")) return;
    setError("");
    start(async () => {
      const res = await removeDeckVersion({ deckId, id: version.id });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const idp = version ? `v-${version.id}` : "v-new";
  return (
    <form className="version-form" onSubmit={submit}>
      <label>
        <span className="lbl">First played on</span>
        <input id={`${idp}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label className="version-note">
        <span className="lbl">What changed</span>
        <textarea
          id={`${idp}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={VERSION_NOTE_MAX}
          rows={2}
          required
          placeholder="e.g. Cut 6 removal, added Rhystic Study"
        />
      </label>
      <label className="version-note">
        <span className="lbl">New deck list link (optional)</span>
        <input
          id={`${idp}-url`}
          type="url"
          inputMode="url"
          value={listUrl}
          onChange={(e) => setListUrl(e.target.value)}
          maxLength={LIST_URL_MAX}
          placeholder="https://…"
          autoComplete="off"
        />
      </label>
      {error && (
        <div className="error version-note" role="alert">
          {error}
        </div>
      )}
      <div className="row version-note">
        <button className={`primary${pending ? " is-pending" : ""}`} type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : version ? "Save change" : "Log change"}
        </button>
        {version && (
          <button type="button" className="danger" onClick={remove} disabled={pending}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
