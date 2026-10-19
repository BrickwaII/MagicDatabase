import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card stack">
      <h1>Not found</h1>
      <p className="muted">That page or record doesn&apos;t exist.</p>
      <Link href="/">Home</Link>
    </div>
  );
}
