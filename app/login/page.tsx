import { redirect } from "next/navigation";
import { DevSignIn, GoogleSignIn } from "@/components/AuthButtons";
import { PodMark } from "@/components/Icons";
import { devLoginEnabled, getCurrentPlayer } from "@/lib/auth";
import { safeCallbackPath } from "@/lib/util";

const MESSAGES: Record<string, string> = {
  NotInvited: "That Google account isn't on the invite list. Ask Henry to add your email.",
  AccessDenied: "That Google account isn't on the invite list. Ask Henry to add your email.",
  CredentialsSignin: "No active player has that email.",
};

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const { error, callbackUrl } = await searchParams;
  const next = safeCallbackPath(callbackUrl);
  if (await getCurrentPlayer()) redirect(next);
  const google = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return (
    <div className="signin">
      <div className="signin-mark">
        <PodMark size={56} />
      </div>
      <h1>Commander Tracker</h1>
      <p className="lede">Log your pod&apos;s games, track decks, and see who&apos;s really winning.</p>
      <div className="card stack">
        {error && (
          <div className="error" role="alert">
            {MESSAGES[error] ?? "Sign-in didn't work. Try again."}
          </div>
        )}
        {google ? <GoogleSignIn callbackUrl={next} /> : <p className="notice small">Google sign-in isn&apos;t set up yet.</p>}
        {devLoginEnabled() && (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
              Development sign-in (off in production)
            </p>
            <DevSignIn callbackUrl={next} />
          </div>
        )}
      </div>
    </div>
  );
}
