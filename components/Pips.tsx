const NAMES: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colorless" };

export function Pips({ colors }: { colors: string }) {
  const list = (colors || "C").split("").filter((c) => "WUBRGC".includes(c));
  return (
    <span className="pips" role="img" aria-label={list.map((c) => NAMES[c]).join(", ")} title={list.join("")}>
      {list.map((c, i) => (
        <span key={i} className={`pip ${c}`} />
      ))}
    </span>
  );
}
