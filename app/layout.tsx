import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { getCurrentPlayer } from "@/lib/auth";
import { listGames } from "@/lib/data";
import { isAdmin } from "@/lib/permissions";
import { SignOutButton } from "@/components/AuthButtons";
import { PodMark } from "@/components/Icons";
import { HeaderNav, TabBar } from "@/components/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Commander Tracker", template: "%s · Commander Tracker" },
  description: "Log your Commander pod's games in seconds and see who's really winning: player, deck and turn-order stats.",
  applicationName: "Commander Tracker",
  appleWebApp: { capable: true, title: "Commander", statusBarStyle: "default" },
  openGraph: {
    title: "Commander Tracker",
    description: "Log your Commander pod's games in seconds and see who's really winning.",
    type: "website",
    siteName: "Commander Tracker",
  },
  twitter: { card: "summary", title: "Commander Tracker", description: "Log your Commander pod's games and see who's really winning." },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1ec" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1714" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentPlayer();
  const admin = isAdmin(me);
  const pending = admin ? (await listGames({ status: "pending" })).length : 0;
  return (
    <html lang="en">
      <body className={me ? "signed-in" : "signed-out"}>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <header className="topbar">
          <div className="wrap">
            <Link href="/" className="brand" aria-label="Commander Tracker home">
              <PodMark />
              <span className="wordmark">Commander Tracker</span>
            </Link>
            {me && <HeaderNav admin={admin} pending={pending} />}
            {me && (
              <div className="who">
                <span className="avatar" aria-hidden="true">
                  {me.display_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="who-name">{me.display_name}</span>
                <SignOutButton />
              </div>
            )}
          </div>
        </header>
        <main className="wrap" id="content">
          {children}
        </main>
        {me && <TabBar />}
      </body>
    </html>
  );
}
