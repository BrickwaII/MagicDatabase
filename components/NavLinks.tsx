"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DecksIcon, GamesIcon, GearIcon, HomeIcon, PlusIcon, QueueIcon, StatsIcon } from "./Icons";

function isOn(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/games") return path === "/games" || (path.startsWith("/games/") && path !== "/games/new");
  return path === href || path.startsWith(`${href}/`);
}

/** Desktop links in the header; on phones only the admin links show here. */
export function HeaderNav({ admin, pending }: { admin: boolean; pending: number }) {
  const path = usePathname() ?? "/";
  const main = [
    { href: "/", label: "Home" },
    { href: "/games", label: "Games" },
    { href: "/stats", label: "Stats" },
    { href: "/decks", label: "Decks" },
  ];
  return (
    <nav className="nav" aria-label="Main">
      {main.map((l) => (
        <Link key={l.href} href={l.href} className={`nav-main${isOn(path, l.href) ? " on" : ""}`} aria-current={isOn(path, l.href) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
      {admin && (
        <>
          <Link href="/queue" className={`nav-admin${isOn(path, "/queue") ? " on" : ""}`} aria-label={`Approval queue, ${pending} waiting`}>
            <QueueIcon size={18} />
            <span className="nav-admin-label">Queue</span>
            {pending > 0 && <span className="badge count">{pending}</span>}
          </Link>
          <Link href="/admin" className={`nav-admin${isOn(path, "/admin") ? " on" : ""}`} aria-label="Admin">
            <GearIcon size={18} />
            <span className="nav-admin-label">Admin</span>
          </Link>
        </>
      )}
      <Link href="/games/new" className="btn primary nav-log">
        <PlusIcon size={18} /> Log game
      </Link>
    </nav>
  );
}

/** Thumb-reach tab bar, phones only. */
export function TabBar() {
  const path = usePathname() ?? "/";
  const tabs = [
    { href: "/", label: "Home", icon: <HomeIcon /> },
    { href: "/games", label: "Games", icon: <GamesIcon /> },
    { href: "/games/new", label: "Log game", icon: <PlusIcon size={26} />, log: true },
    { href: "/stats", label: "Stats", icon: <StatsIcon /> },
    { href: "/decks", label: "Decks", icon: <DecksIcon /> },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => {
        const on = isOn(path, t.href);
        return (
          <Link key={t.href} href={t.href} className={`tab${t.log ? " tab-log" : ""}${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
