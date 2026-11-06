"use client";

import { signIn, signOut } from "next-auth/react";
import { useState } from "react";

export function SignOutButton() {
  return (
    <button className="link small" onClick={() => signOut({ callbackUrl: "/login" })}>
      Sign out
    </button>
  );
}

export function GoogleSignIn() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`primary big${busy ? " is-pending" : ""}`}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        signIn("google", { callbackUrl: "/" });
      }}
    >
      {busy ? "Opening Google…" : "Sign in with Google"}
    </button>
  );
}

export function DevSignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        signIn("dev", { email, callbackUrl: "/" });
      }}
    >
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="player@email"
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button type="submit" className={busy ? "is-pending" : ""} disabled={busy}>
        Dev sign in
      </button>
    </form>
  );
}
