"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggleIcon } from "@/components/ThemeToggle";
import { NAV_LINKS, isActive } from "@/components/nav-links";

/** Slim mobile header — carries the brand and the theme control, which live in
 *  the sidebar footer on desktop. Hidden from `md` up. */
export function MobileTopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-canvas/80 px-4 backdrop-blur md:hidden">
      <Link
        href="/"
        aria-label="Control Center — dashboard"
        className="flex items-center gap-2 font-semibold tracking-tight text-fg-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={22} height={22} aria-hidden="true" />
        Control Center
      </Link>
      <ThemeToggleIcon />
    </header>
  );
}

/** App-style bottom tab bar — the primary navigation on phones. The layout's
 *  `<main>` carries bottom padding to clear it. */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {NAV_LINKS.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
              active ? "text-accent" : "text-fg-faint hover:text-fg-muted"
            }`}
          >
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
