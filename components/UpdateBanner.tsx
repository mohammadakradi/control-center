"use client";

import { useEffect, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";

type UpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  packaged: boolean;
};

const DISMISSED_KEY = "cc:update-dismissed";

/**
 * Tells a long-running instance that a newer release exists. Renders **nothing** in every
 * other case — no update, still checking, offline, or running from a git checkout (where
 * `control-center update` doesn't apply and `git pull` is the answer).
 *
 * Deliberately not a button: applying the update means recreating the container, which the
 * `control-center` CLI does from the host at startup. Wiring it to a click would mean handing
 * the container the Docker socket — root-equivalent access to the host — for a convenience.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/updates")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: UpdateStatus | null) => {
        if (cancelled || !body) return;
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
      cancelled = true;
    };
  }, []);

  if (!status?.updateAvailable || !status.packaged) return null;
  // Dismissal is per-version: a newer release than the one you dismissed speaks up again.
  if (dismissed && status.latest && dismissed === status.latest) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-info-line bg-info-soft px-4 py-2 text-sm text-info sm:px-6">
      <ArrowUpCircle className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Version {status.latest} is available</span>
        <span className="text-fg-subtle">
          {" "}
          — you&apos;re on {status.current}. Quit and start from the launcher to update, or run{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
            control-center update
          </code>
          .
        </span>
      </p>
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
    </div>
  );
}
