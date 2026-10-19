import Link from "next/link";
import { Pips } from "@/components/Pips";
import { requirePlayer } from "@/lib/auth";
import { listGames, listPlayers, listRules } from "@/lib/data";
import { loadNames } from "@/lib/names";
import { BRACKETS, GUEST_PLAYER_ID, POD_SIZES } from "@/lib/schema";
import { deckStats, playerSeatStats, playerStats, seatStats, summary, type SeatTable, type StatsFilter } from "@/lib/stats";

type SP = Record<string, string | string[] | undefined>;
const list = (v: string | string[] | undefined) => (v === undefined ? [] : [v].flat());
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function SeatTables({ tables, perPlayer }: { tables: SeatTable[]; perPlayer?: boolean }) {
  if (tables.length === 0) return <p className="muted">No games match these filters.</p>;
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
      {tables.map((t) => (
        <div key={t.podSize} className="card" style={{ padding: 0 }}>
          <div style={{ padding: "10px 12px" }}>
            <strong>{t.podSize}-player pods</strong>{" "}
            <span className="muted small">
              {t.games} {perPlayer ? "games played" : "games"}
            </span>
          </div>
          <div className="table-wrap">
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
                    <td>{s.seat}</td>
                    <td className="num">{s.played}</td>
                    <td className="num">{s.wins}</td>
                    <td className="num">{pct(s.winRate)}</td>
                    <td className="num">{pct(s.pctPlayed)}</td>
                    <td className="num">{pct(s.pctWon)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function Stats({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePlayer();
  const sp = await searchParams;
  const view = sp.view === "decks" || sp.view === "seats" ? sp.view : "players";
  const submitted = sp.f === "1";
  const filter: Required<StatsFilter> = {
    podSizes: list(sp.pod).map(Number).filter(Boolean),
    brackets: list(sp.bracket),
    ignoredRules: list(sp.norule),
    ignoredPlayers: submitted ? list(sp.noplayer) : [GUEST_PLAYER_ID],
  };
  const seatPlayer = typeof sp.player === "string" ? sp.player : "";
  const [games, players, rules, names] = await Promise.all([listGames(), listPlayers(), listRules(), loadNames()]);
  const sum = summary(games, filter);
  const name = (id: string) => (id === GUEST_PLAYER_ID ? "Guest" : (names.players.get(id)?.display_name ?? id));

  const qs = (v: string) => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (k !== "view") list(val).forEach((x) => p.append(k, x));
    p.set("view", v);
    return `/stats?${p}`;
  };

  return (
    <div className="stack">
      <h1>Stats</h1>
      <div className="tabs">
        {(["players", "decks", "seats"] as const).map((v) => (
          <Link key={v} href={qs(v)} className={view === v ? "on" : ""}>
            {v === "players" ? "Players" : v === "decks" ? "Decks" : "Turn order"}
          </Link>
        ))}
      </div>

      <details className="card" open={submitted}>
        <summary>Filters</summary>
        <form method="get" className="stack" style={{ marginTop: 10 }}>
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="f" value="1" />
          {seatPlayer && <input type="hidden" name="player" value={seatPlayer} />}
          <div>
            <span className="lbl small muted">Pod size (none = all)</span>
            <div className="chips">
              {POD_SIZES.map((n) => (
                <label key={n} className="chip">
                  <input type="checkbox" name="pod" value={n} defaultChecked={filter.podSizes.includes(n)} /> {n} players
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="lbl small muted">Brackets (none = all)</span>
            <div className="chips">
              {BRACKETS.map((b) => (
                <label key={b} className="chip">
                  <input type="checkbox" name="bracket" value={b} defaultChecked={filter.brackets.includes(b)} /> {b}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="lbl small muted">Ignore games with these rules</span>
            <div className="chips">
              {rules.map((r) => (
                <label key={r.id} className="chip">
                  <input type="checkbox" name="norule" value={r.id} defaultChecked={filter.ignoredRules.includes(r.id)} /> {r.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="lbl small muted">Hide players</span>
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
              Apply
            </button>
            <Link href={`/stats?view=${view}`} className="small">
              Reset
            </Link>
          </div>
        </form>
      </details>

      <p className="small muted">
        {sum.counted} approved games counted. Draws ({sum.draws}), unfinished games ({sum.unfinished}) and pending games (
        {sum.pending}) are never counted.
      </p>

      {view === "players" && (
        <div className="table-wrap card" style={{ padding: 0 }}>
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
                  <td>
                    <Link href={`/stats?view=seats&player=${s.player_id}`}>{name(s.player_id)}</Link>
                  </td>
                  <td className="num">{s.games}</td>
                  <td className="num">{s.wins}</td>
                  <td className="num">{pct(s.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "decks" && (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Deck</th>
                <th>Pilot</th>
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
                      {d && <Pips colors={d.colors} />} {d?.name ?? s.deck_id}
                      {d && d.owner_player_id !== s.player_id && <span className="small muted"> ({name(d.owner_player_id)}&apos;s)</span>}
                    </td>
                    <td>{name(s.player_id)}</td>
                    <td className="num">{s.games}</td>
                    <td className="num">{s.wins}</td>
                    <td className="num">{pct(s.winRate)}</td>
                    <td>{s.lastPlayed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "seats" && (
        <div className="stack">
          <form method="get" className="row">
            {Object.entries(sp).map(([k, v]) =>
              k === "player" ? null : list(v).map((x, i) => <input key={`${k}${i}`} type="hidden" name={k} value={x} />),
            )}
            <select name="player" defaultValue={seatPlayer}>
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
              <h2>{name(seatPlayer)}: where they sat vs where they won</h2>
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
