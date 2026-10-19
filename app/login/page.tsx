import { redirect } from "next/navigation";
import { DevSignIn, GoogleSignIn } from "@/components/AuthButtons";
import { devLoginEnabled, getCurrentPlayer } from "@/lib/auth";

const MESSAGES: Record<string, string> = {
  NotInvited: "That Google account isn't on the invite list. Ask Henry to add your email.",
  AccessDenied: "That Google account isn't on the invite list. Ask Henry to add your email.",
  CredentialsSignin: "No active player has that email.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentPlayer()) redirect("/");
  const { error } = await searchParams;
  const google = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return (
    <div className="card stack" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>Sign in</h1>
      <p className="muted">Log your Commander games, track decks, and see who&apos;s really winning.</p>
      {error && <div className="error">{MESSAGES[error] ?? "Sign-in failed. Try again."}</div>}
      {google ? <GoogleSignIn /> : <p className="notice small">Google sign-in isn&apos;t configured yet.</p>}
      {devLoginEnabled() && (
        <div className="stack">
          <p className="small muted">Development login (disabled in production):</p>
          <DevSignIn />
        </div>
      )}
    </div>
  );
}
