export function Pips({ colors }: { colors: string }) {
  const list = (colors || "C").split("").filter((c) => "WUBRGC".includes(c));
  return (
    <span className="pips" aria-label={`Colors: ${colors || "C"}`}>
      {list.map((c, i) => (
        <span key={i} className={`pip ${c}`} />
      ))}
    </span>
  );
}
