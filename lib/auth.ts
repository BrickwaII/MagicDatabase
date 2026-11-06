import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { getPlayerByEmail } from "./data";
import { isAdmin } from "./permissions";
import type { Player } from "./schema";

export const devLoginEnabled = () => process.env.DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

const providers: NextAuthOptions["providers"] = [];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }),
  );
}
if (devLoginEnabled()) {
  providers.push(
    CredentialsProvider({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "Players email", type: "email" } },
      async authorize(creds) {
        const p = creds?.email ? await getPlayerByEmail(creds.email) : null;
        return p ? { id: p.player_id, email: p.email, name: p.display_name } : null;
      },
    }),
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    // The invite list is the players table: only active players with a matching email get in.
    async signIn({ user, account, profile }) {
      if (!user.email) return false;
      // Google can return an address the account holder never verified; don't match those against the invite list.
      if (account?.provider === "google" && (profile as { email_verified?: boolean } | undefined)?.email_verified !== true) {
        return "/login?error=NotInvited";
      }
      return (await getPlayerByEmail(user.email)) ? true : "/login?error=NotInvited";
    },
  },
};

/** The signed-in player, looked up fresh so role changes apply immediately. */
export async function getCurrentPlayer(): Promise<Player | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  return email ? getPlayerByEmail(email) : null;
}

export async function requirePlayer(): Promise<Player> {
  const p = await getCurrentPlayer();
  if (!p) redirect("/login");
  return p;
}

export async function requireAdmin(): Promise<Player> {
  const p = await requirePlayer();
  if (!isAdmin(p)) redirect("/");
  return p;
}
