import Link from "next/link";
import { notFound } from "next/navigation";
import { DeckForm } from "@/components/DeckForm";
import { DeckVersionForm } from "@/components/DeckVersionForm";
import { DeckListLink, formatDate } from "@/components/GameCard";
import { Pips } from "@/components/Pips";
import { requirePlayer } from "@/lib/auth";
import { getDeck, getPlayer, listDeckCommanders, listGames, listPlayers } from "@/lib/data";
import { canEditDeck, isAdmin } from "@/lib/permissions";
import { playerOptions } from "@/lib/schema";
import { deckVersionStats } from "@/lib/stats";
import { listDeckVersions } from "@/lib/versions";

/** Below this many games a version's win rate is flagged as a small sample. */
const FEW_GAMES = 5;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function DeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const me = await requirePlayer();
  const { id } = await params;
  const { edit } = await searchParams;
  const deck = await getDeck(id);
  if (!deck) notFound();
  const editable = canEditDeck(me, deck);

  if (edit && editable) {
    const [players, commanders] = await Promise.all([listPlayers(), listDeckCommanders(id)]);
    return (
      <div className="stack form-page">
        <div className="page-head">
          <h1>Edit {deck.name}</h1>
          <Link className="btn" href={`/decks/${id}`}>
            Cancel
          </Link>
        </div>
        <DeckForm players={playerOptions(players)} meId={me.player_id} admin={isAdmin(me)} deckId={id} initial={{ ...deck, commanders }} />
      </div>
    );
  }

  const [owner, commanders, versions, games] = await Promise.all([
    getPlayer(deck.owner_player_id),
    listDeckCommanders(id),
    listDeckVersions(id),
    listGames({ status: "approved" }),
  ]);
  const stats = deckVersionStats(games, id, versions);
  const total = stats.reduce((a, v) => ({ games: a.games + v.games, wins: a.wins + v.wins, exp: a.exp + v.expected * v.games }), {
    games: 0,
    wins: 0,
    exp: 0,
  });
  const cmd = commanders.filter((c) => c.role !== "companion").map((c) => c.card_name || c.typed_name).join(" + ");
  const companion = commanders.find((c) => c.role === "companion");
  const byNo = new Map(versions.map((v) => [v.version_no, v]));

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="deck-title">
          <Pips colors={deck.colors} /> {deck.name}
        </h1>
        {editable && (
          <Link className="btn" href={`/decks/${id}?edit=1`}>
            Edit deck
          </Link>
        )}
      </div>

      <section className="card stack" aria-label="Deck">
        <div className="deck-meta" style={{ marginTop: 0 }}>
          <span>{owner?.display_name ?? deck.owner_player_id}&apos;s deck</span>
          <span>{cmd || "No commander set"}</span>
          {companion && <span>Companion: {companion.card_name || companion.typed_name}</span>}
          {deck.bracket && <span>Bracket {deck.bracket}</span>}
          {!deck.active && <span>Retired</span>}
          {deck.list_url && <DeckListLink url={deck.list_url} />}
        </div>
        <div className="deck-meta" style={{ marginTop: 0 }}>
          <span>
            <b>{total.games}</b> game{total.games === 1 ? "" : "s"} counted
          </span>
          <span>
            <b>{total.wins}</b> win{total.wins === 1 ? "" : "s"}
          </span>
          <span>
            <b>{total.games ? pct(total.wins / total.games) : "–"}</b> win rate
          </span>
          {total.games > 0 && <span>expected {pct(total.exp / total.games)}</span>}
        </div>
        {deck.notes && <p className="small muted" style={{ margin: 0 }}>{deck.notes}</p>}
      </section>

      <section className="stack" aria-labelledby="versions-h">
        <div className="section-head">
          <h2 id="versions-h">Versions</h2>
          <span className="small muted">A game counts toward the version in use on its date; a change logged on a game day counts from that day.</span>
        </div>
        <ol className="version-list">
          {[...stats].reverse().map((s) => {
            const v = byNo.get(s.version_no);
            const prev = stats.find((x) => x.version_no === s.version_no - 1);
            const diff = prev && prev.games > 0 && s.games > 0 ? (s.winRate - prev.winRate) * 100 : undefined;
            const small = s.games < FEW_GAMES || (prev !== undefined && prev.games < FEW_GAMES);
            const range = v
              ? `${shortDate(s.started_on)} – ${s.until ? shortDate(s.until) : "now"}`
              : s.until
                ? `until ${shortDate(s.until)}`
                : "since the start";
            return (
              <li key={s.version_no} className="card version">
                <div className="version-head">
                  <strong>v{s.version_no}</strong>
                  <span className="muted small">{range}</span>
                  {s.version_no === stats.length && versions.length > 0 && <span className="badge">Current</span>}
                </div>
                <p className="version-text">{v ? v.note : "The deck as first logged."}</p>
                {v?.list_url && <DeckListLink url={v.list_url} />}
                <div className="deck-meta" style={{ marginTop: 0 }}>
                  <span>
                    <b>{s.games}</b> game{s.games === 1 ? "" : "s"}
                  </span>
                  <span>
                    <b>{s.wins}</b> win{s.wins === 1 ? "" : "s"}
                  </span>
                  <span>
                    <b>{s.games ? pct(s.winRate) : "–"}</b> win rate
                  </span>
                  {s.games > 0 && <span>expected {pct(s.expected)}</span>}
                  {diff !== undefined && (
                    <span className="version-diff">
                      {diff > 0 ? "+" : diff < 0 ? "−" : "±"}
                      {Math.abs(diff).toFixed(1)} pts vs v{s.version_no - 1}
                    </span>
                  )}
                  {s.games > 0 && small && <span className="badge">Few games</span>}
                </div>
                {v && editable && (
                  <details className="version-edit">
                    <summary className="small">Edit this change</summary>
                    <DeckVersionForm deckId={id} version={v} />
                  </details>
                )}
                {v && (
                  <span className="small muted">
                    Logged {formatDate(v.created_at.slice(0, 10))}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {versions.length === 0 && <p className="small muted">No changes logged yet. Every game so far counts toward v1.</p>}
      </section>

      {editable && (
        <section className="card stack" aria-labelledby="log-change-h">
          <h2 id="log-change-h" style={{ margin: 0 }}>
            Log a change
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            Swapped cards? Log it to start v{stats.length + 1} and compare how each version did.
          </p>
          <DeckVersionForm deckId={id} />
        </section>
      )}
    </div>
  );
}
