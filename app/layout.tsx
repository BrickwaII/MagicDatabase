import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { getCurrentPlayer } from "@/lib/auth";
import { listGames } from "@/lib/data";
import { isAdmin } from "@/lib/permissions";
import { SignOutButton } from "@/components/AuthButtons";
import "./globals.css";

export const metadata: Metadata = { title: "Commander Tracker", description: "Our Commander games, decks and stats" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentPlayer();
  const admin = isAdmin(me);
  const pending = admin ? (await listGames({ status: "pending" })).length : 0;
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="wrap">
            <Link href="/" className="brand">
              ⚔ Commander Tracker
            </Link>
            {me && (
              <nav className="nav">
                <Link href="/games/new">Log game</Link>
                <Link href="/games">Games</Link>
                <Link href="/decks">Decks</Link>
                <Link href="/stats">Stats</Link>
                {admin && (
                  <Link href="/queue">
                    Queue{pending > 0 && <span className="badge count">{pending}</span>}
                  </Link>
                )}
                {admin && <Link href="/admin">Admin</Link>}
              </nav>
            )}
            {me && (
              <div className="who">
                <span>{me.display_name}</span>
                <SignOutButton />
              </div>
            )}
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
