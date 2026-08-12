"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";
import { ThemeToggleIcon } from "@/components/ThemeToggle";
import { NAV_LINKS, isActive } from "@/components/nav-links";
import { SignOutButton } from "@/components/SignOutButton";

/** Slim mobile header — carries the brand and the theme control, which live in
 *  the sidebar footer on desktop. Hidden from `md` up. */
export function MobileTopBar({ userEmail }: { userEmail?: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-canvas/80 px-4 backdrop-blur md:hidden">
      <Link
        href="/"
        aria-label="Agent Control Center — dashboard"
        className="flex items-center gap-2 font-semibold tracking-tight text-fg-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={22} height={22} aria-hidden="true" />
        Agent Control Center
      </Link>
      <div className="flex items-center gap-1">
        <ThemeToggleIcon />
        {userEmail ? (
          <SignOutButton iconOnly className="p-2" />
        ) : (
          <Link
            href="/signin"
            aria-label="Sign in"
            className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-hover hover:text-fg-strong"
          >
            <LogIn className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
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
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-xs font-medium transition-colors sm:py-2.5 ${
              active ? "text-accent" : "text-fg-faint hover:text-fg-muted"
            }`}
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            {/* Seven tabs at 320px leave ~45px each — narrower than any of these words, so
                below `sm` the bar is icons only and the label is carried by `sr-only`
                (still the link's accessible name, and still what a screen reader announces).
                From 640px the label comes back and truncates if it must. `py-3` below `sm`
                keeps the icon-only target at 44px; with the label out of flow the `gap-1`
                contributes nothing. See `nav-links.tsx`. */}
            <span className="sr-only sm:not-sr-only sm:max-w-full sm:truncate">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
