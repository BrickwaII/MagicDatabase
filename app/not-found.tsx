import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card stack center-card">
      <h1>Nothing here</h1>
      <p className="muted">That page or game doesn&apos;t exist. It may have been deleted, or the link is wrong.</p>
      <div>
        <Link className="btn primary" href="/">
          Go home
        </Link>
      </div>
    </div>
  );
}
