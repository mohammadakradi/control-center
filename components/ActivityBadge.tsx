"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Activity, FolderGit2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ViewAll } from "@/components/ui-cards";
import {
  activityLabel,
  getActiveTasksSnapshot,
  getServerActiveTasksSnapshot,
  subscribeActiveTasks,
} from "@/lib/active-tasks";

/**
 * "N in progress" — the app's only global sign that agents are working, and the shortest path
 * from whatever page you're on to any of them. The wording matches the dashboard's stat tile
 * rather than saying "running", because `ACTIVE_STATUSES` includes queued work and the two
 * approval gates, where nothing is running and you are the hold-up.
 *
 * Renders **nothing** when nothing is in flight, which is most of the time: it is mounted in
 * the app chrome (the desktop strip in `app/(app)/layout.tsx`, the mobile top bar in
 * `MobileNav`), and a permanent "0" would be noise in both. Both mounts read one shared
 * poll — see `lib/active-tasks.ts`.
 *
 * The panel is a plain **disclosure** (`aria-expanded` + `aria-controls` over a list of real
 * links), not a menu: the rows navigate, so `<a>`s in DOM order already give the right tab
 * sequence, and inventing `role="menu"` would owe a keyboard user arrow-key handling that
 * buys them nothing here. Hover opens it as a convenience — never as the only way in.
 */
export function ActivityBadge({ className = "" }: { className?: string }) {
  const { tasks, total } = useSyncExternalStore(
    subscribeActiveTasks,
    getActiveTasksSnapshot,
    getServerActiveTasksSnapshot,
  );

  /** `pinned` separates "opened by click/keyboard" (stays until dismissed) from "opened by
   *  hover" (closes when the pointer leaves). */
  const [openState, setOpenState] = useState<{ pinned: boolean } | null>(null);
  const open = openState !== null;

  /**
   * Close on navigation, by **resetting** state during render — React's documented "adjust
   * state when something changes" pattern, which is not `setState` in an effect (a hard error
   * in this build; see `.fe/notes/environment.md`).
   *
   * The first version derived `open` from `openedAt.path === pathname` instead. That closed
   * the popover on the way out but never cleared it, so coming *back* to the page it was
   * opened on — the browser Back button, or just clicking that nav entry again — popped it
   * open on its own with nobody having touched it. Found by the frontend audit.
   */
  const pathname = usePathname();
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpenState(null);
  }

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = `${useId()}-activity`;

  const close = () => setOpenState(null);
  const openPanel = (pinned: boolean) => setOpenState({ pinned });

  // Close on an outside click, same as `Select`'s popover.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpenState(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Nothing in flight and nothing open: the badge doesn't exist. The `open` half matters —
  // when the last run finishes with the panel open, tearing it out from under the user would
  // also drop keyboard focus to <body>. It stays, says so, and closes on their terms.
  if (total === 0 && !open) return null;

  const rows = tasks ?? [];

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      onPointerEnter={(e) => {
        // Mouse only: on touch this fires just before the click that toggles it.
        if (e.pointerType === "mouse" && !open) openPanel(false);
      }}
      onPointerLeave={() => {
        if (open && !openState.pinned) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          close();
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        // Tabbing out of the last link closes it; focus moving *within* the popover doesn't.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // No `aria-label`: the accessible name is the pill's own text, so WCAG 2.5.3 Label in
        // Name can't drift out of agreement with what's on screen. `title` carries the longer
        // phrasing for a mouse, the way the sidebar's nav items do.
        title={activityLabel(total)}
        onClick={() => (open && openState.pinned ? close() : openPanel(true))}
        // `bg-surface` rather than `bg-warn-soft`: this floats over scrolling page content,
        // and the warn tone's dark-theme value is a translucent wash that content shows
        // through. The border and text carry the tone instead.
        // `py-2` rather than something tighter: this sits beside `ThemeToggleIcon` (36px) and
        // `SignOutButton` (~34px) in the mobile top bar, and a 26px pill next to those read as
        // three unevenly sized controls. Both review passes asked for it.
        className="inline-flex items-center gap-1.5 rounded-full border border-warn-line bg-surface px-2.5 py-2 text-xs font-medium text-warn shadow-sm transition-colors hover:bg-surface-3"
      >
        <Activity className="size-3.5 shrink-0" aria-hidden="true" />
        {total}
        {/* `sr-only`, not `hidden`: `display:none` would drop the word from the accessible
            name too, leaving a button called "2" on the narrowest screens. Same trick
            `MobileTabBar` uses for its labels. */}
        <span className="sr-only sm:not-sr-only">in progress</span>
      </button>

      {open && (
        // The padding lives on this wrapper, not as a gap: it keeps the travel from pill to
        // panel inside the hovered element, so a hover-opened panel doesn't flicker shut
        // halfway there.
        <div className="absolute top-full right-0 z-40 pt-2">
          <div
            id={panelId}
            className="w-80 max-w-[calc(100vw_-_2rem)] overflow-hidden rounded-lg border border-line-strong bg-surface-2 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
              <p className="text-xs font-semibold text-fg-strong">In progress</p>
              <ViewAll href="/tasks" />
            </div>

            {rows.length === 0 ? (
              <p className="px-3 py-4 text-sm text-fg-subtle">
                Nothing in progress now.
              </p>
            ) : (
              <ul className="max-h-72 overflow-y-auto">
                {rows.map((t) => (
                  <li key={t.id} className="border-t border-line first:border-t-0">
                    <Link
                      href={`/tasks/${t.id}`}
                      // A navigation closes the panel on its own (see `shownFor`); this is
                      // for the case where the link is the page you're already on.
                      onClick={close}
                      className="block px-3 py-2.5 hover:bg-hover"
                    >
                      <span className="block truncate text-sm text-fg">
                        {t.name ?? (
                          <span className="text-fg-faint">no description</span>
                        )}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <StatusBadge status={t.status} />
                        {t.project && (
                          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-faint">
                            <FolderGit2
                              className="size-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="sr-only">Project </span>
                            <span className="min-w-0 truncate">{t.project}</span>
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {total > rows.length && (
              // Disclose the remainder rather than showing a quietly short list — the same
              // rule the capped sections on `/tasks` follow.
              <p className="border-t border-line px-3 py-2 text-xs text-fg-faint">
                {`${total - rows.length} more in progress — `}
                <Link href="/tasks" className="text-accent hover:text-accent-hover">
                  see all tasks
                </Link>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
