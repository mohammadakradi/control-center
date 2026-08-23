"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardSection } from "@/components/ui-cards";
import { checkedAgo, versionSummary, type VersionSummary } from "@/lib/update-ui";

type UpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  packaged: boolean;
  checkedAt: number;
  unavailable?: string;
};

/** Same vocabulary as the banner's, applied as one string so two colour utilities of equal
 *  specificity never race in the emitted CSS. */
const TONE: Record<VersionSummary["tone"], string> = {
  ok: "border-ok-line bg-ok-soft text-ok",
  info: "border-info-line bg-info-soft text-info",
  warn: "border-warn-line bg-warn-soft text-warn",
  muted: "border-line bg-sunken text-fg-muted",
};

/**
 * Which version this install is on, and a way to ask again on the spot.
 *
 * The banner only appears when there is something to install, which is correct but leaves
 * "am I current?" unanswerable — and after several releases went unnoticed, the honest answer
 * to that is exactly what was missing. This card always has one, including for the states the
 * banner deliberately renders as nothing: offline, rate-limited, a release still uploading its
 * assets, or a git checkout that the launcher can't update at all.
 *
 * "Check now" sends `?force=1`, which reaches past the server's memo — but the server keeps a
 * floor under forced checks, so an answer seconds old comes straight back from the cache. That
 * is why the timestamp is on screen: it is what makes a cached reply readable as "yes, really,
 * this is current" instead of a button that did nothing.
 */
export function VersionSettings() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ticks so "just now" doesn't sit there for an hour while the window stays open. */
  const [now, setNow] = useState(() => Date.now());
  const cancelled = useRef(false);

  /** The "Check now" button. Only ever called from an event handler — see the effect below. */
  const check = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/updates?force=1", { cache: "no-store" });
      const body = (await res.json()) as UpdateStatus;
      if (cancelled.current) return;
      setStatus(body);
      setNow(Date.now());
    } catch {
      if (!cancelled.current) setError("Couldn't reach the server.");
    } finally {
      if (!cancelled.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    // A promise chain rather than `check()`, because that function's first statement is a
    // setState and a *synchronous* setState in an effect body is a hard error in this React
    // build. `UpdateBanner`'s mount effect is written this way for the same reason.
    fetch("/api/updates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: UpdateStatus | null) => {
        if (cancelled.current || !body) return;
        setStatus(body);
        setNow(Date.now());
      })
      .catch(() => {
        /* An unanswered version check is not worth an error on a settings page. */
      });
    // "just now" would otherwise still say so an hour later on a window nobody closed.
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      cancelled.current = true;
      clearInterval(timer);
    };
  }, []);

  const summary = status
    ? versionSummary(status)
    : { headline: "Checking…", body: "", tone: "muted" as const };

  return (
    <CardSection
      title="Version"
      right={
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={() => void check()}
          icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
        >
          Check now
        </Button>
      }
    >
      <div className={`rounded-xl border px-4 py-3 text-sm ${TONE[summary.tone]}`}>
        <p className="font-medium" aria-live="polite">
          {summary.headline}
        </p>
        {summary.body && <p className="mt-0.5">{summary.body}</p>}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}

      {status && (
        <p className="mt-3 text-xs text-fg-faint">
          {`Last checked ${checkedAgo(status.checkedAt, now)}. The app re-checks on its own every half hour, and whenever you come back to this window.`}
        </p>
      )}
    </CardSection>
  );
}
