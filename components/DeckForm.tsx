"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { saveDeck } from "@/app/actions";
import { BRACKETS, COLOR_ORDER, LIST_URL_MAX, type DeckCommander, type PlayerOption } from "@/lib/schema";
import {
  byOracleId,
  canPair,
  commanderQuery,
  companionQuery,
  identityOf,
  partnerQuery,
  search,
  type ScryCard,
} from "@/lib/scryfall";
import { Pips } from "./Pips";

/** A commander slot is either a real Scryfall card or a typed, unresolved name. */
interface Slot {
  oracle_id: string;
  name: string;
  typed: string;
  card?: ScryCard;
}
const emptySlot: Slot = { oracle_id: "", name: "", typed: "" };

function slotFrom(c?: DeckCommander): Slot {
  return c ? { oracle_id: c.scryfall_oracle_id, name: c.card_name, typed: c.typed_name } : emptySlot;
}
const hasSlot = (s: Slot) => !!(s.oracle_id || s.typed.trim());

function CardSearch({
  label,
  buildQuery,
  filter,
  onPick,
  placeholder,
}: {
  label: string;
  buildQuery: (text: string) => string | null;
  filter?: (c: ScryCard) => boolean;
  onPick: (c: ScryCard) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<ScryCard[]>([]);
  const [status, setStatus] = useState("");
  const seq = useRef(0);
  // Callers pass inline functions; read them through refs so only typing triggers a search.
  const queryRef = useRef(buildQuery);
  const filterRef = useRef(filter);
  queryRef.current = buildQuery;
  filterRef.current = filter;

  useEffect(() => {
    const q = text.trim().length >= 2 ? queryRef.current(text) : null;
    if (!q) {
      setResults([]);
      setStatus("");
      return;
    }
    const n = ++seq.current;
    setStatus("Searching…");
    const t = setTimeout(async () => {
      try {
        const f = filterRef.current;
        const found = (await search(q, 30)).filter((c) => !f || f(c));
        if (n !== seq.current) return;
        setResults(found.slice(0, 12));
        setStatus(found.length ? "" : "No legal matches on Scryfall.");
      } catch {
        if (n === seq.current) setStatus("Scryfall didn't respond. You can type the name instead.");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <div>
      <label>
        <span className="lbl">{label}</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? "Search Scryfall…"} style={{ width: "100%" }} />
      </label>
      {status && <div className="small muted">{status}</div>}
      {results.length > 0 && (
        <ul className="results">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(c);
                  setText("");
                  setResults([]);
                }}
              >
                {c.image && <img src={c.image} alt="" />}
                <span>
                  <strong>{c.name}</strong>
                  <br />
                  <span className="small muted">
                    <Pips colors={identityOf([c])} /> {c.type_line}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SlotEditor({
  title,
  slot,
  setSlot,
  buildQuery,
  filter,
  allowTyped = true,
}: {
  title: string;
  slot: Slot;
  setSlot: (s: Slot) => void;
  buildQuery: (text: string) => string | null;
  filter?: (c: ScryCard) => boolean;
  allowTyped?: boolean;
}) {
  const [typing, setTyping] = useState(!slot.oracle_id && !!slot.typed);
  if (slot.oracle_id) {
    return (
      <div className="spread card" style={{ padding: 10 }}>
        <span>
          <span className="small muted">{title}: </span>
          <strong>{slot.name}</strong> {slot.card && <Pips colors={identityOf([slot.card])} />}
          {slot.typed && slot.typed !== slot.name && <span className="small muted"> (entered as “{slot.typed}”)</span>}
        </span>
        <button type="button" className="link" onClick={() => setSlot(emptySlot)}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="stack">
      {!typing ? (
        <CardSearch
          label={title}
          buildQuery={buildQuery}
          filter={filter}
          onPick={(c) => setSlot({ oracle_id: c.oracle_id, name: c.name, typed: slot.typed, card: c })}
        />
      ) : (
        <label>
          <span className="lbl">{title} (typed, linked later)</span>
          <input value={slot.typed} onChange={(e) => setSlot({ ...slot, typed: e.target.value })} placeholder="Name as you know it" style={{ width: "100%" }} />
        </label>
      )}
      {allowTyped && (
        <button type="button" className="link small" onClick={() => setTyping(!typing)} style={{ alignSelf: "start" }}>
          {typing ? "Search Scryfall instead" : "Can't find it? Type a name and pick colors"}
        </button>
      )}
    </div>
  );
}

interface Props {
  players: PlayerOption[];
  meId: string;
  admin: boolean;
  deckId?: string;
  initial?: {
    owner_player_id: string;
    name: string;
    colors: string;
    bracket: string;
    notes: string;
    active: boolean;
    list_url: string;
    commanders: DeckCommander[];
  };
}

export function DeckForm({ players, meId, admin, deckId, initial }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [owner, setOwner] = useState(initial?.owner_player_id ?? meId);
  const [name, setName] = useState(initial?.name ?? "");
  const [bracket, setBracket] = useState(initial?.bracket ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [listUrl, setListUrl] = useState(initial?.list_url ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [manualColors, setManualColors] = useState(initial?.colors ?? "");
  const cmds = initial?.commanders ?? [];
  const [first, setFirst] = useState<Slot>(slotFrom(cmds.find((c) => c.role === "commander")));
  const [second, setSecond] = useState<Slot>(slotFrom(cmds.find((c) => c.role === "partner")));
  const [companion, setCompanion] = useState<Slot>(slotFrom(cmds.find((c) => c.role === "companion")));
  const [showSecond, setShowSecond] = useState(hasSlot(second));

  // Existing decks only store the oracle id; fetch full cards for pairing rules and colors.
  useEffect(() => {
    for (const [slot, set] of [
      [first, setFirst],
      [second, setSecond],
      [companion, setCompanion],
    ] as const) {
      if (slot.oracle_id && !slot.card) {
        byOracleId(slot.oracle_id)
          .then((card) => card && set((s) => (s.oracle_id === card.oracle_id ? { ...s, card } : s)))
          .catch(() => {});
      }
    }
  }, []);

  const firstCard = first.card;
  const mainSlots = [first, ...(showSecond ? [second] : [])].filter(hasSlot);
  const resolved = mainSlots.length > 0 && mainSlots.every((s) => s.oracle_id);
  const resolvedCards = mainSlots.map((s) => s.card).filter((c): c is ScryCard => !!c);
  const derivedColors = resolved && resolvedCards.length === mainSlots.length ? identityOf(resolvedCards) : "";
  const colors = derivedColors || manualColors;

  const partnerQ = (text: string) => (firstCard ? partnerQuery(firstCard, text) : null);
  const partnerFilter = (c: ScryCard) => !!firstCard && canPair(firstCard, c);
  const firstCanPair = !first.oracle_id || !firstCard || partnerQuery(firstCard, "") !== null;

  function pickFirst(s: Slot) {
    setFirst(s);
    if (s.card && !name) setName(s.card.name.split(/[,/]/)[0].trim());
    if (s.oracle_id !== first.oracle_id) setSecond(emptySlot);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!hasSlot(first)) return setError("Pick a commander, or type its name");
    if (!colors) return setError("Pick the deck's colors");
    const toCmd = (s: Slot, role: DeckCommander["role"]) => ({
      role,
      scryfall_oracle_id: s.oracle_id,
      card_name: s.name,
      typed_name: s.typed || s.name,
    });
    const commanders = [
      toCmd(first, "commander"),
      ...(showSecond && hasSlot(second) ? [toCmd(second, "partner")] : []),
      ...(hasSlot(companion) ? [toCmd(companion, "companion")] : []),
    ];
    start(async () => {
      const res = await saveDeck({
        id: deckId,
        active,
        input: { owner_player_id: owner, name, colors, bracket: bracket as never, notes, commanders, list_url: listUrl },
      });
      if (res.ok) {
        router.push(`/decks/${res.id}`);
        router.refresh();
      } else setError(res.error);
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="card stack">
        <div className="deck-top">
          {admin && (
            <label>
              <span className="lbl">Owner</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                {players.map((p) => (
                  <option key={p.player_id} value={p.player_id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="deck-top-name">
            <span className="lbl">Deck nickname</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required style={{ width: "100%" }} placeholder="e.g. Tifa" />
          </label>
          <label>
            <span className="lbl">Bracket</span>
            <select value={bracket} onChange={(e) => setBracket(e.target.value)}>
              <option value="">—</option>
              {BRACKETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <fieldset className="card stack">
        <legend>Commander</legend>
        <SlotEditor title="Commander" slot={first} setSlot={pickFirst} buildQuery={commanderQuery} />
        {showSecond ? (
          <>
            {first.oracle_id && firstCard ? (
              firstCanPair ? (
                <SlotEditor title="Partner / Background" slot={second} setSlot={setSecond} buildQuery={partnerQ} filter={partnerFilter} />
              ) : (
                <p className="small muted">{first.name} can&apos;t have a second commander.</p>
              )
            ) : first.oracle_id ? (
              <p className="small muted">Loading card…</p>
            ) : (
              <SlotEditor title="Second commander" slot={second} setSlot={setSecond} buildQuery={commanderQuery} />
            )}
            <button type="button" className="link small" style={{ alignSelf: "start" }} onClick={() => (setShowSecond(false), setSecond(emptySlot))}>
              Remove second commander
            </button>
          </>
        ) : (
          firstCanPair && (
            <button type="button" className="link small" style={{ alignSelf: "start" }} onClick={() => setShowSecond(true)}>
              + Partner, Background, Friends forever or Doctor&apos;s companion
            </button>
          )
        )}
        <SlotEditor title="Companion (optional)" slot={companion} setSlot={setCompanion} buildQuery={companionQuery} />
        <p className="small muted">
          Decks that swap commanders stay one deck — note which commanders were played in each game&apos;s notes.
        </p>
      </fieldset>

      <fieldset className="card">
        <legend>Colors</legend>
        {derivedColors ? (
          <span>
            <Pips colors={derivedColors} /> {derivedColors} <span className="small muted">from the commanders&apos; color identity</span>
          </span>
        ) : (
          <div className="chips">
            {[...COLOR_ORDER, "C"].map((c) => {
              const on = manualColors.includes(c);
              return (
                <label key={c} className={`chip${on ? " on" : ""}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() =>
                      setManualColors((m) =>
                        c === "C" ? (on ? "" : "C") : on ? m.replace(c, "") : m.replace("C", "") + c,
                      )
                    }
                  />
                  <Pips colors={c} /> {c}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <label className="card">
        <span className="lbl">Deck list link (optional)</span>
        <input
          type="url"
          inputMode="url"
          value={listUrl}
          onChange={(e) => setListUrl(e.target.value)}
          maxLength={LIST_URL_MAX}
          placeholder="https://moxfield.com/decks/… or Archidekt, any site"
          autoComplete="off"
          style={{ width: "100%" }}
        />
      </label>

      <label className="card">
        <span className="lbl">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {deckId && (
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (uncheck to retire the deck; its games keep counting)
        </label>
      )}
      {!resolved && hasSlot(first) && (
        <p className="small notice">This deck will be saved as unresolved; an admin can link the real card later.</p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div>
        <button className={`primary big${pending ? " is-pending" : ""}`} disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : deckId ? "Save deck" : "Add deck"}
        </button>
      </div>
    </form>
  );
}
