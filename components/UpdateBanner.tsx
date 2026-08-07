"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type UpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  packaged: boolean;
};

const DISMISSED_KEY = "cc:update-dismissed";
const POLL_MS = 2000;
/** Long enough for download + deps + build + migrate on a slow machine. */
const GIVE_UP_MS = 6 * 60 * 1000;

/**
 * Tells a long-running instance that a newer release exists, and applies it on request.
 * Renders **nothing** in every other case — no update, still checking, offline, or running
 * from a git checkout (where `control-center update` doesn't apply and `git pull` is
 * the answer).
 *
 * The app still doesn't update *itself*: the button hands the work to a detached
 * `control-center update` (see `app/api/updates/apply/route.ts`), because applying an update
 * means replacing the files of the process that would be doing it. What the button really
 * buys is that the user doesn't need a terminal — which, in a window with no address bar and
 * no menu, was the difference between "there's an update" and "there's an update I can get".
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the server refused because work is in flight — the count it reported. */
  const [activeTasks, setActiveTasks] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    let done = false;
    fetch("/api/updates")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: UpdateStatus | null) => {
        if (done || !body) return;
        // Both reads happen here rather than in the effect body: `localStorage` isn't
        // available while this renders on the server, and a synchronous setState in an
        // effect body is a hard lint error in this React build.
        setDismissed(localStorage.getItem(DISMISSED_KEY));
        setStatus(body);
      })
      .catch(() => {
        /* the update check is the least important thing on the page */
      });
    return () => {
      done = true;
      cancelled.current = true;
    };
  }, []);

  /**
   * Wait for the *new* version to answer. Watching the version rather than "does it respond"
   * matters: the server this asked is still up for a moment after the request, so a liveness
   * check would call it done immediately and reload the page it was already on.
   */
  const waitForRestart = useCallback(async (from: string) => {
    const deadline = Date.now() + GIVE_UP_MS;
    while (!cancelled.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const res = await fetch("/api/updates", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as UpdateStatus;
          if (body.current && body.current !== from) {
            window.location.reload();
            return;
          }
        }
      } catch {
        /* expected: the server is down for the swap. Keep waiting. */
      }
    }
    if (!cancelled.current) setStalled(true);
  }, []);

  async function applyUpdate(force = false) {
    setError(null);
    setApplying(true);
    const res = await fetch("/api/updates/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => ({}))) ?? {}) as {
      error?: string;
      activeTasks?: number;
    };

    if (res?.status === 409) {
      setApplying(false);
      setActiveTasks(body.activeTasks ?? 1);
      setError(body.error ?? null);
      return;
    }
    if (!res?.ok) {
      setApplying(false);
      setError(body.error ?? "Couldn't start the update.");
      return;
    }
    setActiveTasks(null);
    if (status) waitForRestart(status.current);
  }

  if (!status?.updateAvailable || !status.packaged) return null;
  // Dismissal is per-version: a newer release than the one you dismissed speaks up again.
  if (dismissed && status.latest && dismissed === status.latest) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-info-line bg-info-soft px-4 py-2 text-sm text-info sm:px-6">
      <ArrowUpCircle className="size-4 shrink-0" aria-hidden="true" />

      <p className="min-w-0 flex-1" aria-live="polite">
        {stalled ? (
          <span className="text-fg-subtle">
            The update is still running. If this page doesn&apos;t come back on
            its own, quit Agent Control Center and open it again.
          </span>
        ) : applying ? (
          <span className="text-fg-subtle">
            Updating to {status.latest}… the server restarts, and this page
            reconnects on its own.
          </span>
        ) : (
          <>
            <span className="font-medium">
              Version {status.latest} is available
            </span>
            <span className="text-fg-subtle"> — you&apos;re on {status.current}.</span>
            {error && (
              <span className="text-warn"> {error}</span>
            )}
          </>
        )}
      </p>

      {!stalled && (
        <Button
          size="sm"
          variant="primary"
          className="shrink-0"
          onClick={() => applyUpdate(activeTasks !== null)}
          loading={applying}
          icon={!applying ? <ArrowUpCircle className="size-3.5" /> : undefined}
        >
          {applying
            ? "Updating…"
            : activeTasks !== null
              ? "Update anyway"
              : "Update now"}
        </Button>
      )}

      {status.releaseUrl && (
        <a
          href={status.releaseUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-medium underline underline-offset-2 hover:text-accent-hover"
        >
          Release notes
        </a>
      )}

      {!applying && (
        <button
          type="button"
          onClick={() => {
            if (!status.latest) return;
            localStorage.setItem(DISMISSED_KEY, status.latest);
            setDismissed(status.latest);
          }}
          aria-label={`Dismiss the update notice for version ${status.latest}`}
          className="shrink-0 rounded-lg p-1 text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg-strong"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
