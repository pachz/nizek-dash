import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

export type AppSection =
  | "board"
  | "summary"
  | "commits"
  | "chats"
  | "release"
  | "admin";

const NAV: Array<{
  id: AppSection;
  href: string;
  label: string;
  match: (path: string) => boolean;
}> = [
  { id: "board", href: "/", label: "Board", match: (p) => p === "/" },
  {
    id: "summary",
    href: "/summary",
    label: "Summary",
    match: (p) => p === "/summary" || p.startsWith("/summary/"),
  },
  {
    id: "commits",
    href: "/commits",
    label: "Commits",
    match: (p) => p === "/commits" || p.startsWith("/commits/"),
  },
  {
    id: "chats",
    href: "/chats",
    label: "Chats",
    match: (p) => p === "/chats" || p.startsWith("/chats/"),
  },
  {
    id: "release",
    href: "/release",
    label: "Release",
    match: (p) => p === "/release" || p.startsWith("/release/"),
  },
  {
    id: "admin",
    href: "/admin",
    label: "Admin",
    match: (p) => p === "/admin" || p.startsWith("/admin/"),
  },
];

const SUBTITLES: Record<AppSection, string> = {
  board: "Combined board",
  summary: "Two-day digest",
  commits: "Commit intelligence",
  chats: "Panel chats",
  release: "Release maker",
  admin: "Admin",
};

function subscribePath(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getPath() {
  return window.location.pathname;
}

type AppHeaderProps = {
  /** Page-specific controls (search, toggles, sync buttons). */
  tools?: ReactNode;
  /** Override the subtitle under the brand. */
  subtitle?: string;
};

export function AppHeader({ tools, subtitle }: AppHeaderProps) {
  const path = useSyncExternalStore(subscribePath, getPath, () => "/");
  const active = NAV.find((item) => item.match(path))?.id ?? "board";

  return (
    <header className="topbar glass-strong">
      <a className="brand" href="/" aria-label="Nizek+ home">
        <img
          className="brand-mark"
          src="/nizek-logo.png"
          alt=""
          width={42}
          height={42}
        />
        <div className="brand-copy">
          <p className="brand-name">
            Nizek<span>+</span>
          </p>
          <p className="brand-sub">{subtitle ?? SUBTITLES[active]}</p>
        </div>
      </a>

      <nav className="app-nav" aria-label="Primary">
        {NAV.map((item) => (
          <a
            key={item.id}
            href={item.href}
            className="app-nav-link"
            data-active={active === item.id}
            aria-current={active === item.id ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {tools ? <div className="top-actions">{tools}</div> : null}
    </header>
  );
}
