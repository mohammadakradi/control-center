"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { FolderGit2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { statusBorderColor } from "@/lib/ui";
import {
  dismissAllToasts,
  dismissToast,
  getServerToastsSnapshot,
  getToastsSnapshot,
  subscribeToasts,
  type Toast,
} from "@/lib/toast";
import { setSuppressedTask, startTaskToastWatcher } from "@/lib/task-toasts";

/** `/tasks/task_1234abcd` → `task_1234abcd`. Anything else → null. */
function taskIdFromPath(pathname: string): string | null {
  const match = /^\/tasks\/([^/]+)/.exec(pathname);
  return match ? match[1] : null;
}

/**
 * The app's notification layer: one card per task that needs you or has just finished,
 * anywhere in the app.
 *
 * Mounted **once**, last in `app/(app)/layout.tsx`. Being last is what puts it above an open
 * `Modal` at the same `z-50` rather than behind its scrim.
 *
 * Two things about the container are load-bearing rather than tidy:
 * - **It is always in the DOM, even with nothing to show.** A live region has to exist *before*
 *   content is inserted into it for a screen reader to announce that content; mounting the
 *   region along with the first toast announces nothing.
 * - **Which forces `pointer-events-none` on it**, re-enabled per card. A permanently mounted
 *   fixed element over the bottom corner would otherwise swallow clicks on whatever is under
 *   it for the entire life of the page.
 *
 * One `aria-live="polite"` region covers every tone, deliberately — no `role="alert"` on the
 * failures. Nesting an assertive alert inside a polite region is two announcements for one
 * event, the trap `UpdateBanner` documents; and a run that failed while you were on another
 * page is news, not an emergency worth interrupting a screen reader mid-sentence for.
 *
 * See `lib/toast.ts` for why nothing here auto-dismisses.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(
    subscribeToasts,
    getToastsSnapshot,
    getServerToastsSnapshot,
  );

  // Both effects only ever sync *out* to a module store — no `setState` in an effect, which
  // this build rejects outright.
  useEffect(() => startTaskToastWatcher(), []);

  const pathname = usePathname();
  const openTaskId = taskIdFromPath(pathname);
  useEffect(() => {
    setSuppressedTask(openTaskId);
    // Not cleared on unmount: the layout owns this component for the whole session, and the
    // next navigation is what changes it.
  }, [openTaskId]);

  return (
    <div
      // `bottom-24` clears the fixed mobile tab bar (the same 6rem `<main>` reserves with
      // `pb-24`); from `md` the bar is gone and it sits in the corner. Full-bleed minus the
      // page gutter on a phone, a fixed column from `sm`.
      className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:w-96 md:right-6 md:bottom-6"
      role="region"
      aria-label="Task notifications"
    >
      {/*
        The stack is anchored by its *bottom*, so it grows upward — and four cards on a short
        viewport (a phone in landscape) push the topmost one off screen. That is the wrong card
        to lose: oldest sits furthest from the bottom, so what gets clipped is the
        longest-pending gate. Hence a scroll container rather than trusting `TOAST_LIMIT`
        (lowering the cap doesn't fix it — three cards overflow a landscape phone too).

        Two things make this fiddlier than one utility. `pointer-events-auto` has to be on the
        scrollable element itself, or the scroll gesture lands on the `pointer-events-none`
        parent and does nothing. And `overflow` clips at the padding edge, which would shear the
        flat sides off every card's `shadow-2xl` — so the container needs padding, which it
        cancels with an equal negative margin to keep the cards exactly where they were.

        Both only apply **when there is something to show**: this `<ol>` is the always-mounted
        live region, and padding on an empty one would give it height and put a
        click-swallowing strip over the corner for the life of the page — the very thing
        `pointer-events-none` is here to prevent.
      */}
      <ol
        className={
          toasts.length
            ? "pointer-events-auto -m-2 flex max-h-[calc(100dvh-10rem)] flex-col gap-2 overflow-y-auto p-2"
            : "flex flex-col gap-2"
        }
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} />
        ))}
      </ol>
      {toasts.length > 1 && (
        <div className="pointer-events-auto flex justify-end">
          {/* `secondary`, not `ghost`: this floats over scrolling page content with nothing
              behind it, and a transparent button there is unreadable over the wrong
              paragraph. Same reason the cards are `bg-surface`. */}
          <Button variant="secondary" size="sm" onClick={dismissAllToasts}>
            Dismiss all
          </Button>
        </div>
      )}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  // "no description" is what `TaskList` and `ActivityBadge` already call a nameless run —
  // `taskDisplayTitle` leaves the last resort to the caller, and inventing a second phrase for
  // it here would mean the same task reads differently in two places.
  const label = toast.title ?? "no description";
  const name = toast.title ? (
    <span className="line-clamp-2">{toast.title}</span>
  ) : (
    <span className="line-clamp-2 text-fg-faint">no description</span>
  );

  return (
    <li
      // `bg-surface` + a tone-tinted border, never `bg-{tone}-soft`: this floats over
      // scrolling page content and `--{tone}-soft` is a translucent wash in dark mode, which
      // content shows straight through. The same rule `ActivityBadge`'s pill follows. The
      // border *width* ships inside `statusBorderColor` so there is only ever one
      // border-colour utility on this element.
      className={`pointer-events-auto animate-toast-in rounded-xl bg-surface p-3 shadow-2xl ${statusBorderColor(toast.status)}`}
    >
      <div className="flex items-start justify-between gap-2">
        {/* The status *is* the headline — `StatusBadge` already spells out which gate is
            waiting ("Awaiting change approval") or how the run ended, with an icon beside the
            word, so nothing here is carried by colour alone and no second vocabulary can
            drift from `STATUS_LABEL`. */}
        <StatusBadge status={toast.status} />
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Dismiss notification: ${label}`}
          onClick={() => dismissToast(toast.id)}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {toast.taskId ? (
        <Link
          href={`/tasks/${toast.taskId}`}
          // Dismiss on the way out: following it is dealing with the notice, and coming back
          // to a card about the page you're on would be the one place it can't help.
          onClick={() => dismissToast(toast.id)}
          className="mt-2 block text-sm text-fg hover:text-accent"
        >
          {name}
        </Link>
      ) : (
        <p className="mt-2 text-sm text-fg">{name}</p>
      )}

      {toast.project && (
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-faint">
          <FolderGit2 className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">Project </span>
          <span className="min-w-0 truncate">{toast.project}</span>
        </p>
      )}
    </li>
  );
}
