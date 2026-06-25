"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, FolderGit2, LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";

const LINKS: { href: string; label: string; icon: ReactNode }[] = [
  { href: "/", label: "Dashboard", icon: <LayoutDashboard className="size-5" /> },
  { href: "/agents", label: "Agents", icon: <Boxes className="size-5" /> },
  { href: "/projects", label: "Projects", icon: <FolderGit2 className="size-5" /> },
];

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export function Nav() {
  const pathname = usePathname();
  return (
    <>
      <header className="border-b border-neutral-800 bg-neutral-950/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="Control Center logo" width={24} height={24} />
            Control Center
          </Link>
          {/* Desktop / tablet: inline links. On mobile these move to the bottom bar. */}
          <nav aria-label="Primary" className="hidden gap-1 text-sm sm:flex">
            {LINKS.map((l) => {
              const active = isActive(pathname, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-900"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Mobile: app-style bottom tab bar. Hidden from sm up. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-neutral-800 bg-neutral-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        {LINKS.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                active
                  ? "text-white"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {l.icon}
              {l.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
