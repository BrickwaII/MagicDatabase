"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveGame } from "@/app/actions";
import { BRACKETS, GUEST_PLAYER_ID, MAX_SEATS, MIN_SEATS, type Deck, type GameResult, type Lookup, type Player } from "@/lib/schema";

interface SeatState {
  player_id: string;
  deck_id: string;
  is_winner: boolean;
}

export interface GameFormInitial {
  date: string;
  result: GameResult;
  brackets: string[];
  win_conditions: string[];
  additional_rules: string[];
  notes: string;
  seats: SeatState[];
}

interface Props {
  players: Player[];
  decks: Deck[];
  winConditions: Lookup[];
  rules: Lookup[];
  meId: string;
  gameId?: string;
  rev?: number;
  initial?: GameFormInitial;
  /** Shown above the save button, e.g. "this will go back to the approval queue". */
  saveNote?: string;
}

const emptySeat = (): SeatState => ({ player_id: "", deck_id: "", is_winner: false });

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function GameForm({ players, decks, winConditions, rules, meId, gameId, rev, initial, saveNote }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [date, setDate] = useState(initial?.date ?? "");
  const [result, setResult] = useState<GameResult>(initial?.result ?? "won");
  const [brackets, setBrackets] = useState<string[]>(initial?.brackets ?? []);
  const [wcs, setWcs] = useState<string[]>(initial?.win_conditions ?? []);
  const [ruleIds, setRuleIds] = useState<string[]>(initial?.additional_rules ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [seats, setSeats] = useState<SeatState[]>(
    initial?.seats ?? [{ player_id: meId, deck_id: "", is_winner: false }, emptySeat(), emptySeat(), emptySeat()],
  );

  useEffect(() => {
    if (!date) setDate(localToday());
  }, [date]);

  const decksByOwner = new Map<string, Deck[]>();
  for (const d of decks) decksByOwner.set(d.owner_player_id, [...(decksByOwner.get(d.owner_player_id) ?? []), d]);
  const playerName = (id: string) => players.find((p) => p.player_id === id)?.display_name ?? id;

  const setSeat = (i: number, patch: Partial<SeatState>) =>
    setSeats((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const move = (i: number, dir: -1 | 1) =>
    setSeats((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const takenIds = new Set(seats.map((s) => s.player_id).filter((id) => id && id !== GUEST_PLAYER_ID));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await saveGame({
        id: gameId,
        rev,
        input: { date, result, brackets: brackets as never, win_conditions: wcs, additional_rules: ruleIds, notes, seats },
      });
      if (res.ok) {
        router.push(`/games/${res.id}`);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="card row">
        <label>
          <span className="lbl">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          <span className="lbl">Result</span>
          <select value={result} onChange={(e) => setResult(e.target.value as GameResult)}>
            <option value="won">Someone won</option>
            <option value="draw">Draw</option>
            <option value="unfinished">Unfinished</option>
          </select>
        </label>
        {result !== "won" && <span className="small muted">Draws and unfinished games are saved but not counted in stats.</span>}
      </div>

      <fieldset className="card">
        <legend>Seats, in turn order</legend>
        <div className="stack">
          {seats.map((s, i) => {
            const guest = s.player_id === GUEST_PLAYER_ID;
            const own = decksByOwner.get(s.player_id) ?? [];
            const others = decks.filter((d) => d.owner_player_id !== s.player_id);
            return (
              <div key={i} className="seat-edit">
                <strong className="muted n">{i + 1}</strong>
                <select
                  className="player"
                  aria-label={`Seat ${i + 1} player`}
                  value={s.player_id}
                  onChange={(e) => setSeat(i, { player_id: e.target.value, deck_id: "" })}
                  required
                >
                  <option value="">Player…</option>
                  {players.map((p) => (
                    <option key={p.player_id} value={p.player_id} disabled={takenIds.has(p.player_id) && p.player_id !== s.player_id}>
                      {p.display_name}
                    </option>
                  ))}
                  <option value={GUEST_PLAYER_ID}>Guest (untracked)</option>
                </select>
                <select
                  className="deck"
                  aria-label={`Seat ${i + 1} deck`}
                  value={s.deck_id}
                  onChange={(e) => setSeat(i, { deck_id: e.target.value })}
                  disabled={guest || !s.player_id}
                  required={!guest}
                >
                  <option value="">{guest ? "—" : "Deck…"}</option>
                  {own.length > 0 && (
                    <optgroup label={`${playerName(s.player_id)}'s decks`}>
                      {own.map((d) => (
                        <option key={d.deck_id} value={d.deck_id}>
                          {d.name} ({d.colors})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {others.length > 0 && !guest && (
                    <optgroup label="Borrowed">
                      {others.map((d) => (
                        <option key={d.deck_id} value={d.deck_id}>
                          {d.name} ({playerName(d.owner_player_id)})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <label className={`chip win${s.is_winner ? " on" : ""}`} style={{ opacity: result === "won" ? 1 : 0.4 }}>
                  <input
                    type="checkbox"
                    checked={s.is_winner && result === "won"}
                    disabled={result !== "won"}
                    onChange={(e) => setSeat(i, { is_winner: e.target.checked })}
                  />
                  Won
                </label>
                <span className="moves">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === seats.length - 1} aria-label="Move down">
                    ↓
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => setSeats((x) => x.filter((_, j) => j !== i))}
                    disabled={seats.length <= MIN_SEATS}
                    aria-label="Remove seat"
                  >
                    ✕
                  </button>
                </span>
              </div>
            );
          })}
          {seats.length < MAX_SEATS && (
            <button type="button" onClick={() => setSeats((s) => [...s, emptySeat()])}>
              + Add seat
            </button>
          )}
        </div>
      </fieldset>

      <fieldset className="card stack">
        <legend>Details</legend>
        <div>
          <span className="lbl small muted">Brackets</span>
          <div className="chips">
            {BRACKETS.map((b) => (
              <label key={b} className={`chip${brackets.includes(b) ? " on" : ""}`}>
                <input type="checkbox" checked={brackets.includes(b)} onChange={() => setBrackets((x) => toggle(x, b))} />
                {b}
              </label>
            ))}
          </div>
        </div>
        {result === "won" && (
          <div>
            <span className="lbl small muted">Win conditions</span>
            <div className="chips">
              {winConditions.map((w) => (
                <label key={w.id} className={`chip${wcs.includes(w.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={wcs.includes(w.id)} onChange={() => setWcs((x) => toggle(x, w.id))} />
                  {w.name}
                </label>
              ))}
              {winConditions.length === 0 && <span className="small muted">None set up yet.</span>}
            </div>
          </div>
        )}
        <div>
          <span className="lbl small muted">Additional rules</span>
          <div className="chips">
            {rules.map((r) => (
              <label key={r.id} className={`chip${ruleIds.includes(r.id) ? " on" : ""}`}>
                <input type="checkbox" checked={ruleIds.includes(r.id)} onChange={() => setRuleIds((x) => toggle(x, r.id))} />
                {r.name}
              </label>
            ))}
            {rules.length === 0 && <span className="small muted">None set up yet.</span>}
          </div>
        </div>
        <label>
          <span className="lbl">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering. For swap-commander decks, note which commanders were played."
          />
        </label>
      </fieldset>

      {error && <div className="error">{error}</div>}
      {saveNote && <p className="small muted">{saveNote}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : gameId ? "Save changes" : "Submit game"}
        </button>
      </div>
    </form>
  );
}
