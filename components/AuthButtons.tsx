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
  return (
    <button className="primary" onClick={() => signIn("google", { callbackUrl: "/" })}>
      Sign in with Google
    </button>
  );
}

export function DevSignIn() {
  const [email, setEmail] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        signIn("dev", { email, callbackUrl: "/" });
      }}
    >
      <input type="email" placeholder="player@email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit">Dev sign in</button>
    </form>
  );
}
