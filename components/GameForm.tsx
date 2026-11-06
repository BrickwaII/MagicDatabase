"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveGame } from "@/app/actions";
import { CloseIcon, CrownIcon, DownIcon, UpIcon } from "./Icons";
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

  const winnerNames = result === "won" ? seats.filter((s) => s.is_winner && s.player_id).map((s) => (s.player_id === GUEST_PLAYER_ID ? "Guest" : playerName(s.player_id))) : [];
  const resultOptions: { value: GameResult; label: string }[] = [
    { value: "won", label: "Won" },
    { value: "draw", label: "Draw" },
    { value: "unfinished", label: "Unfinished" },
  ];

  return (
    <form className="game-form" onSubmit={submit}>
      <section className="card form-top">
        <label className="field">
          <span className="lbl">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <div className="field">
          <span className="lbl" id="result-label">
            Result
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="result-label">
            {resultOptions.map((o) => (
              <label key={o.value} className={`seg-opt${result === o.value ? " on" : ""}`}>
                <input
                  type="radio"
                  name="result-choice"
                  value={o.value}
                  checked={result === o.value}
                  onChange={() => setResult(o.value)}
                  className="sr-only"
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>
        {result !== "won" && <p className="small muted field-wide">Draws and unfinished games are saved but not counted in stats.</p>}
      </section>

      <section className="form-section" aria-labelledby="seats-h">
        <div className="section-head">
          <h2 id="seats-h">Seats</h2>
          <span className="small muted">In turn order. Seat 1 went first.</span>
        </div>
        <ol className="seat-list">
          {seats.map((s, i) => {
            const guest = s.player_id === GUEST_PLAYER_ID;
            const own = decksByOwner.get(s.player_id) ?? [];
            const others = decks.filter((d) => d.owner_player_id !== s.player_id);
            const won = s.is_winner && result === "won";
            return (
              <li key={i} className={`seat-card${won ? " won" : ""}`}>
                <div className="seat-card-head">
                  <span className="seat-num">Seat {i + 1}</span>
                  <span className="moves">
                    <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move seat ${i + 1} up`}>
                      <UpIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => move(i, 1)}
                      disabled={i === seats.length - 1}
                      aria-label={`Move seat ${i + 1} down`}
                    >
                      <DownIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => setSeats((x) => x.filter((_, j) => j !== i))}
                      disabled={seats.length <= MIN_SEATS}
                      aria-label={`Remove seat ${i + 1}`}
                    >
                      <CloseIcon />
                    </button>
                  </span>
                </div>
                <div className="seat-card-body">
                  <div className="seat-selects">
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
                      <option value="">{guest ? "No deck for guests" : s.player_id ? "Deck…" : "Pick a player first"}</option>
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
                  </div>
                  <label className={`win-toggle${won ? " on" : ""}${result !== "won" ? " off" : ""}`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={won}
                      disabled={result !== "won"}
                      onChange={(e) => setSeat(i, { is_winner: e.target.checked })}
                    />
                    <CrownIcon size={20} />
                    <span>{won ? "Winner" : "Won?"}</span>
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
        {seats.length < MAX_SEATS && (
          <button type="button" className="add-seat" onClick={() => setSeats((s) => [...s, emptySeat()])}>
            + Add seat {seats.length + 1}
          </button>
        )}
      </section>

      <section className="form-section" aria-labelledby="details-h">
        <div className="section-head">
          <h2 id="details-h">Details</h2>
          <span className="small muted">Optional</span>
        </div>
        <div className="card stack">
          <div>
            <span className="lbl">Bracket</span>
            <div className="chips">
              {BRACKETS.map((b) => (
                <label key={b} className={`chip chip-num${brackets.includes(b) ? " on" : ""}`}>
                  <input type="checkbox" className="sr-only" checked={brackets.includes(b)} onChange={() => setBrackets((x) => toggle(x, b))} />
                  {b}
                </label>
              ))}
            </div>
          </div>
          {result === "won" && (
            <div>
              <span className="lbl">How it was won</span>
              <div className="chips">
                {winConditions.map((w) => (
                  <label key={w.id} className={`chip${wcs.includes(w.id) ? " on" : ""}`}>
                    <input type="checkbox" className="sr-only" checked={wcs.includes(w.id)} onChange={() => setWcs((x) => toggle(x, w.id))} />
                    {w.name}
                  </label>
                ))}
                {winConditions.length === 0 && <span className="small muted">None set up yet.</span>}
              </div>
            </div>
          )}
          <div>
            <span className="lbl">Extra rules in play</span>
            <div className="chips">
              {rules.map((r) => (
                <label key={r.id} className={`chip${ruleIds.includes(r.id) ? " on" : ""}`}>
                  <input type="checkbox" className="sr-only" checked={ruleIds.includes(r.id)} onChange={() => setRuleIds((x) => toggle(x, r.id))} />
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
              rows={3}
              placeholder="Anything worth remembering. For swap-commander decks, note which commanders were played."
            />
          </label>
        </div>
      </section>

      {saveNote && <p className="small muted">{saveNote}</p>}
      <div className="submit-bar">
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="submit-row">
          <span className="submit-summary small">
            {result !== "won" ? (
              <>{result === "draw" ? "Draw" : "Unfinished"}, not counted</>
            ) : winnerNames.length ? (
              <>
                <CrownIcon size={14} /> {winnerNames.join(" & ")}
              </>
            ) : (
              <span className="muted">No winner picked yet</span>
            )}
          </span>
          <button className={`primary big${pending ? " is-pending" : ""}`} type="submit" disabled={pending} aria-busy={pending}>
            {pending ? "Saving…" : gameId ? "Save changes" : "Save game"}
          </button>
        </div>
      </div>
    </form>
  );
}
