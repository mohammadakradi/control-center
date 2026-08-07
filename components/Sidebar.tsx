"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  LogIn,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  getServerSidebarCollapsed,
  getSidebarCollapsed,
  subscribeSidebar,
  toggleSidebar,
} from "@/lib/sidebar";
import { ThemeToggle, ThemeToggleIcon } from "@/components/ThemeToggle";
import { NAV_LINKS, isActive } from "@/components/nav-links";
import { SignOutButton } from "@/components/SignOutButton";

/** Desktop primary navigation. Hidden below `md`, where `MobileNav` takes over.
 *
 *  Collapse is styled entirely through the `rail:` variant (driven by
 *  `data-sidebar` on <html>), so the width is correct on first paint. React only
 *  reads the state to keep ARIA attributes honest. */
export function Sidebar({
  userEmail,
  version,
}: {
  userEmail?: string;
  /** The running version — passed in because reading it touches the filesystem. */
  version?: string;
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    getSidebarCollapsed,
    getServerSidebarCollapsed,
  );

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 rail:w-16 md:flex">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-4 rail:justify-center rail:px-0">
        <Link
          href="/"
          aria-label="Agent Control Center — dashboard"
          className="flex items-center gap-2.5 rounded-lg font-semibold tracking-tight text-fg-strong"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={26} height={26} aria-hidden="true" />
          <span className="rail:hidden">Agent Control Center</span>
        </Link>
      </div>

      {/* Links */}
      <nav aria-label="Primary" className="flex-1 px-3 rail:px-2">
        <p className="mb-2 px-2 text-[11px] font-medium tracking-wider text-fg-ghost uppercase rail:hidden">
          Navigate
        </p>
        <ul className="space-y-1">
          {NAV_LINKS.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  title={label}
                  className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors rail:justify-center rail:px-0 ${
                    active
                      ? "bg-surface-2 text-fg-strong"
                      : "text-fg-subtle hover:bg-hover hover:text-fg"
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent rail:hidden"
                    />
                  )}
                  <Icon
                    className={`size-4.5 shrink-0 ${active ? "text-accent" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="rail:hidden">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="space-y-2 border-t border-line p-3 rail:px-2">
        {userEmail ? (
          <>
            <div className="rail:hidden">
              <p
                title={userEmail}
                className="truncate px-2 text-xs text-fg-faint"
              >
                {userEmail}
              </p>
              <SignOutButton className="w-full px-3 py-2 text-sm" />
            </div>
            <div className="hidden justify-center rail:flex">
              <SignOutButton iconOnly className="p-2" />
            </div>
          </>
        ) : (
          /* Signing in is optional — it starts a private workspace rather than unlocking
             anything, so this is an offer, not a demand. */
          <div className="rail:hidden">
            <p className="px-2 text-xs text-fg-faint">Local workspace</p>
            <Link
              href="/signin"
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg-subtle transition-colors hover:bg-hover hover:text-fg-strong"
              title="Sign in to keep your tasks and token private from others using this device"
            >
              <LogIn className="size-4" aria-hidden="true" />
              Sign in
            </Link>
          </div>
        )}
        {!userEmail && (
          <div className="hidden justify-center rail:flex">
            <Link
              href="/signin"
              aria-label="Sign in"
              title="Sign in to keep your data private"
              className="rounded-lg p-2 text-fg-subtle transition-colors hover:bg-hover hover:text-fg-strong"
            >
              <LogIn className="size-4" aria-hidden="true" />
            </Link>
          </div>
        )}

        <div className="rail:hidden">
          <ThemeToggle />
        </div>
        <div className="hidden justify-center rail:flex">
          <ThemeToggleIcon />
        </div>

        <button
          type="button"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-faint transition-colors hover:bg-hover hover:text-fg rail:justify-center rail:px-0"
        >
          <PanelLeftClose className="size-4.5 shrink-0 rail:hidden" aria-hidden="true" />
          <PanelLeftOpen
            className="hidden size-4.5 shrink-0 rail:block"
            aria-hidden="true"
          />
          <span className="rail:hidden">Collapse</span>
        </button>

        {version && (
          <p
            className="px-3 text-[11px] text-fg-ghost rail:hidden"
            title={`Agent Control Center ${version}`}
          >
            v{version}
          </p>
        )}
      </div>
    </aside>
  );
}
