import { requireAdmin } from "@/lib/auth";
import { listAudit } from "@/lib/data";

export default async function Audit() {
  await requireAdmin();
  const entries = await listAudit(300);
  return (
    <div className="stack">
      <h1>Audit log</h1>
      <p className="small muted">Latest 300 changes, newest first. Full history is in the AuditLog tab.</p>
      <div className="table-wrap card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td className="small">{e.timestamp.replace("T", " ").slice(0, 16)}</td>
                <td>{e.user}</td>
                <td>
                  {e.action} {e.entity}{" "}
                  {e.entity === "game" ? <a href={`/games/${e.entity_id}`}>{e.entity_id}</a> : <span className="muted">{e.entity_id}</span>}
                </td>
                <td style={{ whiteSpace: "normal" }}>
                  <details>
                    <summary className="small">before / after</summary>
                    <pre className="small" style={{ whiteSpace: "pre-wrap", maxWidth: 520 }}>
                      {e.before && `before: ${e.before}\n`}
                      {e.after && `after: ${e.after}`}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
