"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card stack center-card" role="alert">
      <h1>This page didn&apos;t load</h1>
      <p className="muted">
        Something went wrong on the server. Your data is safe. Try again, and if it keeps happening, tell Henry
        {error.digest ? ` (error ${error.digest})` : ""}.
      </p>
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="primary" onClick={reset}>
          Try again
        </button>
        <a className="btn" href="/">
          Go home
        </a>
      </div>
    </div>
  );
}
