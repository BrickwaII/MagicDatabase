// Stats tabs, filters and tables. Used by /stats (signed in) and the public
// share page /s/<token>; it renders only what it's given and links only
// within `basePath`.
import Link from "next/link";
import type { ReactNode } from "react";
import { Pips } from "@/components/Pips";
import { BRACKETS, GUEST_PLAYER_ID, POD_SIZES, type GameWithSeats, type Lookup } from "@/lib/schema";
import { deckStats, playerSeatStats, playerStats, seatStats, summary, type SeatTable, type StatsFilter } from "@/lib/stats";

export type SP = Record<string, string | string[] | undefined>;
const list = (v: string | string[] | undefined) => (v === undefined ? [] : [v].flat());
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export interface StatsNames {
  players: Map<string, { display_name: string }>;
  decks: Map<string, { name: string; colors: string; owner_player_id: string }>;
}

export interface StatsViewProps {
  sp: SP;
  /** Path the tabs, filters and links point at, e.g. "/stats". */
  basePath: string;
  games: GameWithSeats[];
  /** Players offered in the "hide players" filter and the turn-order picker. */
  players: { player_id: string; display_name: string }[];
  rules: Lookup[];
  names: StatsNames;
  heading?: ReactNode;
  /** Public view: don't mention pending games. */
  publicView?: boolean;
}

function SeatTables({ tables, perPlayer }: { tables: SeatTable[]; perPlayer?: boolean }) {
  if (tables.length === 0)
    return (
      <div className="empty">
        <strong>No games match these filters</strong>
        Loosen the filters above to see turn-order stats.
      </div>
    );
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))" }}>
      {tables.map((t) => (
        <section key={t.podSize} className="card table-card">
          <div className="section-head" style={{ padding: "12px 12px 0" }}>
            <h3 style={{ margin: 0 }}>{t.podSize}-player pods</h3>
            <span className="muted small">
              {t.games} {perPlayer ? "games played" : "games"}
            </span>
          </div>
          <div className="table-wrap sticky-col">
            <table>
              <thead>
                <tr>
                  <th>Seat</th>
                  <th className="num">Played</th>
                  <th className="num">Wins</th>
                  <th className="num">Win %</th>
                  <th className="num">% played</th>
                  <th className="num">% of wins</th>
                </tr>
              </thead>
              <tbody>
                {t.seats.map((s) => (
                  <tr key={s.seat}>
                    <td className="strong">Seat {s.seat}</td>
                    <td className="num">{s.played}</td>
                    <td className="num">{s.wins}</td>
                    <td className="num win-pct">{pct(s.winRate)}</td>
                    <td className="num">{pct(s.pctPlayed)}</td>
                    <td className="num">{pct(s.pctWon)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

export function StatsView({ sp, basePath, games, players, rules, names, heading = <h1>Stats</h1>, publicView }: StatsViewProps) {
  const view = sp.view === "decks" || sp.view === "seats" ? sp.view : "players";
  const submitted = sp.f === "1";
  const filter: Required<StatsFilter> = {
    podSizes: list(sp.pod).map(Number).filter(Boolean),
    brackets: list(sp.bracket),
    ignoredRules: list(sp.norule),
    ignoredPlayers: submitted ? list(sp.noplayer) : [GUEST_PLAYER_ID],
  };
  const seatPlayer = typeof sp.player === "string" ? sp.player : "";
  const sum = summary(games, filter);
  const name = (id: string) => (id === GUEST_PLAYER_ID ? "Guest" : (names.players.get(id)?.display_name ?? id));

  const qs = (v: string) => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (k !== "view") list(val).forEach((x) => p.append(k, x));
    p.set("view", v);
    return `${basePath}?${p}`;
  };

  return (
    <div className="stack">
      <div className="page-head">{heading}</div>
      <nav className="tabs" aria-label="Stats views">
        {(["players", "decks", "seats"] as const).map((v) => (
          <Link key={v} href={qs(v)} className={view === v ? "on" : ""}>
            {v === "players" ? "Players" : v === "decks" ? "Decks" : "Turn order"}
          </Link>
        ))}
      </nav>

      <details className="card" open={submitted}>
        <summary>
          Filters
          <span className="summary-hint">{sum.counted} games counted</span>
        </summary>
        <form method="get" action={basePath} className="stack" style={{ marginTop: 10 }}>
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="f" value="1" />
          {seatPlayer && <input type="hidden" name="player" value={seatPlayer} />}
          <div>
            <span className="lbl">Pod size (none picked = all)</span>
            <div className="chips">
              {POD_SIZES.map((n) => (
                <label key={n} className="chip">
                  <input type="checkbox" name="pod" value={n} defaultChecked={filter.podSizes.includes(n)} /> {n} players
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="lbl">Brackets (none picked = all)</span>
            <div className="chips">
              {BRACKETS.map((b) => (
                <label key={b} className="chip">
                  <input type="checkbox" name="bracket" value={b} defaultChecked={filter.brackets.includes(b)} /> {b}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="lbl">Leave out games with these rules</span>
            <div className="chips">
              {rules.map((r) => (
                <label key={r.id} className="chip">
                  <input type="checkbox" name="norule" value={r.id} defaultChecked={filter.ignoredRules.includes(r.id)} /> {r.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="lbl">Hide players</span>
            <div className="chips">
              <label className="chip">
                <input type="checkbox" name="noplayer" value={GUEST_PLAYER_ID} defaultChecked={filter.ignoredPlayers.includes(GUEST_PLAYER_ID)} /> Guest
              </label>
              {players.map((p) => (
                <label key={p.player_id} className="chip">
                  <input type="checkbox" name="noplayer" value={p.player_id} defaultChecked={filter.ignoredPlayers.includes(p.player_id)} />{" "}
                  {p.display_name}
                </label>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="primary" type="submit">
              Apply filters
            </button>
            <Link href={`${basePath}?view=${view}`} className="btn">
              Reset
            </Link>
          </div>
        </form>
      </details>

      <p className="small muted">
        {publicView ? (
          <>
            Counting {sum.counted} games. Draws ({sum.draws}) and unfinished ({sum.unfinished}) games never count.
          </>
        ) : (
          <>
            Counting {sum.counted} approved games. Draws ({sum.draws}), unfinished ({sum.unfinished}) and pending ({sum.pending}) games
            never count.
          </>
        )}
      </p>

      {view === "players" && (
        <div className="card table-card">
          <div className="table-wrap sticky-col">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Games</th>
                <th className="num">Wins</th>
                <th className="num">Win %</th>
              </tr>
            </thead>
            <tbody>
              {playerStats(games, filter).map((s) => (
                <tr key={s.player_id}>
                  <td className="strong">
                    <Link href={`${basePath}?view=seats&player=${encodeURIComponent(s.player_id)}`}>{name(s.player_id)}</Link>
                  </td>
                  <td className="num">{s.games}</td>
                  <td className="num">{s.wins}</td>
                  <td className="num win-pct">{pct(s.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {view === "decks" && (
        <div className="card table-card">
          <div className="table-wrap sticky-col">
          <table>
            <thead>
              <tr>
                <th>Deck and pilot</th>
                <th className="num">Games</th>
                <th className="num">Wins</th>
                <th className="num">Win %</th>
                <th>Last played</th>
              </tr>
            </thead>
            <tbody>
              {deckStats(games, filter).map((s) => {
                const d = names.decks.get(s.deck_id);
                return (
                  <tr key={`${s.player_id}|${s.deck_id}`}>
                    <td>
                      <span className="cell-deck">
                        {d && <Pips colors={d.colors} />} <strong>{d?.name ?? s.deck_id}</strong>
                      </span>
                      <span className="cell-sub">
                        {name(s.player_id)}
                        {d && d.owner_player_id !== s.player_id && <>, borrowed from {name(d.owner_player_id)}</>}
                      </span>
                    </td>
                    <td className="num">{s.games}</td>
                    <td className="num">{s.wins}</td>
                    <td className="num win-pct">{pct(s.winRate)}</td>
                    <td className="muted">{s.lastPlayed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {view === "seats" && (
        <div className="stack">
          <form method="get" action={basePath} className="deck-filter">
            {Object.entries(sp).map(([k, v]) =>
              k === "player" ? null : list(v).map((x, i) => <input key={`${k}${i}`} type="hidden" name={k} value={x} />),
            )}
            <select name="player" defaultValue={seatPlayer} aria-label="Whose turn-order stats">
              <option value="">Everyone</option>
              {players.map((p) => (
                <option key={p.player_id} value={p.player_id}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <button type="submit">Show</button>
          </form>
          {seatPlayer ? (
            <>
              <h2>{name(seatPlayer)}: where they sat and where they won</h2>
              <SeatTables tables={playerSeatStats(games, seatPlayer, filter)} perPlayer />
            </>
          ) : (
            <SeatTables tables={seatStats(games, filter)} />
          )}
        </div>
      )}
    </div>
  );
}
