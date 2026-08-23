"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowUpCircle,
  Check,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import {
  blockedCopy,
  failureCopy,
  isFreshRun,
  NO_ANSWER_ERROR,
  phaseForRun,
  phaseOnLoad,
  shouldRecheck,
  stalledCopy,
  startErrorCopy,
  taskCount,
  uptodateCopy,
  type UpdateRunView,
} from "@/lib/update-ui";

type UpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  packaged: boolean;
  /** When the answer was obtained — the server's stamp, which survives its own cache. */
  checkedAt: number;
  /** The last update attempt (`lib/update-run.ts`); null in a checkout, or if there wasn't one. */
  run: UpdateRunView | null;
};

const DISMISSED_KEY = "cc:update-dismissed";
const POLL_MS = 2000;
/** Long enough for download + deps + build + migrate on a slow machine. */
const GIVE_UP_MS = 6 * 60 * 1000;
/**
 * How often the idle banner *considers* re-checking. Deliberately far shorter than
 * `RECHECK_MS`: `shouldRecheck` is what decides, and a coarse timer that happens to fire a
 * second early would otherwise skip a whole interval and double the wait. A bare timer costs
 * nothing — no request is made unless the answer is genuinely old.
 */
const TICK_MS = 60 * 1000;

/**
 * Every state this bar can be in. One union rather than the four independent booleans this used
 * to hold (`applying`, `stalled`, `error`, `activeTasks`) — the combinations were what let a
 * refused update render as "the same bar with a differently-labelled button", which is the bug.
 */
type Phase =
  | { kind: "idle" }
  | { kind: "applying" }
  /** Refused: work is in flight. Needs a second, deliberate click. */
  | { kind: "blocked"; count: number | null; serverMessage: string | null }
  /** It ran and stopped (`run`), or it never started at all (`startError`). */
  | { kind: "failed"; run: UpdateRunView | null; startError: string | null }
  /** The wait ran out with no outcome recorded. `answering`: did the last poll get a reply. */
  | { kind: "stalled"; answering: boolean; logPath: string | null }
  | { kind: "uptodate" };

/**
 * Tone is the signal that something changed, so it is per-phase and applied as one string —
 * never two same-specificity colour utilities on one element, which race in the emitted CSS
 * rather than resolving in source order.
 */
const TONE = {
  info: "border-info-line bg-info-soft text-info",
  ok: "border-ok-line bg-ok-soft text-ok",
  warn: "border-warn-line bg-warn-soft text-warn",
  danger: "border-danger-line bg-danger-soft text-danger",
} as const;

/**
 * What the bar shows when it is saying something other than "an update exists". One shape for
 * every such state, so the render path reads fields rather than re-deriving which state it's in.
 */
type Notice = {
  tone: string;
  /** Any lucide icon: they share this signature. */
  Icon: typeof ArrowUpCircle;
  headline: string;
  body: string;
  /** The one link that resolves this state, rendered inside the sentence. */
  link?: { href: string; label: string };
  logTail?: string | null;
  logPath?: string | null;
};

/**
 * Tells a long-running instance that a newer release exists, applies it on request, and says
 * what happened. Renders **nothing** in every other case — no update, still checking, offline,
 * or running from a git checkout (where `control-center update` doesn't apply and `git pull` is
 * the answer).
 *
 * The app still doesn't update *itself*: the button hands the work to a detached
 * `control-center update` (see `app/api/updates/apply/route.ts`), because applying an update
 * means replacing the files of the process that would be doing it. What the button really buys
 * is that the user doesn't need a terminal — which, in a window with no address bar and no menu,
 * was the difference between "there's an update" and "there's an update I can get".
 *
 * Two things it has to get right, both of which it previously got wrong:
 *
 * - **A refused update is its own state, not a relabelled button.** `POST …/apply` answers 409
 *   whenever a task is in an active status — which includes a task simply waiting at a gate, the
 *   most common thing on this platform. The bar changes tone, leads with the count, and spells
 *   out what pressing on costs, because "Update anyway" appearing where "Update now" was is
 *   indistinguishable from a button that did nothing.
 * - **A failure is reported the moment it's known.** `GET /api/updates` carries the last
 *   attempt's record (`run`), and `apply_update()` does the download, the checksum, `pnpm
 *   install` and `next build` all *before* it stops the server — so the server is still
 *   answering for the failures that actually happen, and the reason (`die`'s own words) arrives
 *   within a poll. The six-minute timeout is now only for the case where nothing can be learned
 *   at all.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [logOpen, setLogOpen] = useState(false);
  const cancelled = useRef(false);
  /**
   * The most recent record we've seen. Read when an attempt starts, so a *previous* failure
   * can't be reported as the outcome of the click just made (`isFreshRun`).
   */
  const lastRun = useRef<UpdateRunView | null>(null);
  /**
   * The newest release we've told the user about. A re-check that turns up a *different* one
   * retires whatever terminal notice is on screen — "You're on the latest version" must not sit
   * above a bar offering 0.11.0.
   */
  const seenLatest = useRef<string | null>(null);
  /** The version the server was reporting as *installed*. A change means it was replaced. */
  const seenCurrent = useRef<string | null>(null);
  /** A re-check already on the wire — see `refresh`. */
  const refreshing = useRef(false);
  /** The action that never unmounts, so it can be given focus by one that does. */
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  /** Set when we take that action away from someone who was standing on it. */
  const reclaimFocus = useRef(false);
  const logId = useId();

  /**
   * Enter the applying state, remembering whether we're about to disable the element that has
   * focus.
   *
   * `loading` disables the button — and disabling the focused element drops focus to the document.
   * So pressing "Update now" by keyboard left focus nowhere for as long as the request took, and
   * the outcome then arrived on a control nobody was standing on. Measured in a browser, not
   * reasoned about: it looked fine right up until the probe reported `activeElement` as `BODY`.
   */
  function startApplying() {
    reclaimFocus.current =
      typeof document !== "undefined" &&
      document.activeElement === primaryRef.current;
    setPhase({ kind: "applying" });
  }

  /**
   * Adopt a fresh status, retiring a notice that was about a different release.
   *
   * A changed `current` means the server we're talking to has been *replaced* — the update
   * landed, and everything server-rendered on this page is from the old version. So this
   * reloads, exactly as `waitForRestart` does. Without it a background re-check could quietly
   * complete an update whose banner had already given up: the bar would simply vanish from
   * under a user still reading "the server hasn't come back, quit and open it again"
   * (correctness review).
   */
  const adopt = useCallback((body: UpdateStatus) => {
    if (seenCurrent.current !== null && seenCurrent.current !== body.current) {
      window.location.reload();
      return;
    }
    seenCurrent.current = body.current;
    if (seenLatest.current !== null && seenLatest.current !== body.latest) {
      setPhase({ kind: "idle" });
    }
    seenLatest.current = body.latest;
    setStatus(body);
    lastRun.current = body.run ?? null;
  }, []);

  /**
   * Ask the server where we stand. `force` reaches past its cache for a deliberate "Check now" —
   * the server keeps its own floor under that, so this can't be turned into a request loop.
   *
   * `refreshing` is not belt-and-braces: `visibilitychange` and `focus` both fire on a single
   * real refocus, in the same turn, before either fetch's `setStatus` has committed — so both
   * see the same `checkedAt`, both pass `shouldRecheck`, and two requests go out for one event.
   * A ref rather than state, because it has to be readable and writable synchronously within
   * that turn.
   */
  const refresh = useCallback(
    async (force = false) => {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        const res = await fetch(force ? "/api/updates?force=1" : "/api/updates", {
          cache: "no-store",
        }).catch(() => null);
        if (!res?.ok) return;
        const body = (await res.json().catch(() => null)) as UpdateStatus | null;
        // Resumed after two awaits: this instance may be gone (a sign-out redirect mid-fetch).
        if (!body || cancelled.current) return;
        adopt(body);
      } finally {
        refreshing.current = false;
      }
    },
    [adopt],
  );

  /**
   * Watch an attempt through to an outcome.
   *
   * `previous` is the record that was already there when *we* started one, and `null` means
   * we're adopting an attempt that was already under way. The distinction matters because a
   * record keeps its `startedAt` from `running` through to `failed`: for an attempt we started,
   * an unchanged stamp means the old record and must be ignored; for one we adopted, its own
   * writes are the only news there is.
   *
   * Watching the *version* is still what proves success — the server this asked is up for a
   * moment after the request, so a liveness check would call it done immediately and reload the
   * page it was already on.
   */
  const waitForRestart = useCallback(
    async (from: string, previous: UpdateRunView | null) => {
      const deadline = Date.now() + GIVE_UP_MS;
      let answering = false;
      let logPath = previous?.logPath ?? null;

      while (!cancelled.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        let body: UpdateStatus | null = null;
        let replied = false;
        try {
          const res = await fetch("/api/updates", { cache: "no-store" });
          // Answering at all is the thing being measured, whatever it answered: it separates
          // "this is slow" from "the server went away", and only the second is worth telling
          // someone to quit and reopen the app for.
          replied = true;
          if (res.ok) body = (await res.json()) as UpdateStatus;
        } catch {
          /* expected: the server is down for the swap. Keep waiting. */
        }
        // Re-check *after* the awaits and before anything observable: the loop condition was
        // last evaluated a poll ago, and this iteration can reload the window. Cancelled means
        // this instance is gone (a sign-out redirect mid-wait, say), and navigating a page the
        // user has already left is worse than the update going unreported. Everything below is
        // synchronous, so one gate here covers all three exits.
        if (cancelled.current) return;
        answering = replied;
        if (!body) continue;

        if (body.current && body.current !== from) {
          window.location.reload();
          return;
        }
        lastRun.current = body.run ?? null;
        logPath = body.run?.logPath ?? logPath;

        if (!isFreshRun(body.run, previous)) continue;
        const found = phaseForRun(body.run);
        if (found === "failure" && body.run) {
          setPhase({ kind: "failed", run: body.run, startError: null });
          return;
        }
        if (found === "uptodate") {
          setPhase({ kind: "uptodate" });
          return;
        }
      }
      if (!cancelled.current) setPhase({ kind: "stalled", answering, logPath });
    },
    [],
  );

  useEffect(() => {
    // Reset alongside the cleanup below: an effect that mounts, unmounts and mounts again (React
    // in development does exactly that) would otherwise start its second life already cancelled.
    cancelled.current = false;
    let done = false;
    fetch("/api/updates")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: UpdateStatus | null) => {
        if (done || !body) return;
        // Both reads happen here rather than in the effect body: `localStorage` isn't
        // available while this renders on the server, and a synchronous setState in an
        // effect body is a hard lint error in this React build.
        setDismissed(localStorage.getItem(DISMISSED_KEY));
        // Not `adopt`: on the very first answer there is nothing to compare against, and the
        // phase is about to be set from the record below rather than reset to idle.
        seenLatest.current = body.latest;
        seenCurrent.current = body.current;
        setStatus(body);
        lastRun.current = body.run ?? null;
        const found = phaseOnLoad(body.run);
        if (found === "failure" && body.run) {
          // Nothing else will ever mention it: the run that failed is over, and its only other
          // trace is a log file in a directory this window can't open.
          setPhase({ kind: "failed", run: body.run, startError: null });
        } else if (found === "running") {
          // An update is already going — started from another window, or by this one before a
          // reload. Offering "Update now" here invites a click that can only be refused.
          setPhase({ kind: "applying" });
          void waitForRestart(body.current, null);
        }
      })
      .catch(() => {
        /* the update check is the least important thing on the page */
      });
    return () => {
      done = true;
      cancelled.current = true;
    };
  }, [waitForRestart]);

  /**
   * Keep asking. This is the fix for "I never saw a notification after several releases".
   *
   * The effect above runs once per *mount*, and this component mounts in
   * `app/(app)/layout.tsx` — a persistent App Router layout that client-side navigation never
   * remounts. So on a window that stays open (which is exactly what the Mac app is) the check
   * happened when the window opened and never again, and a release published afterwards was
   * invisible until someone reloaded.
   *
   * Two triggers, because they cover different neglect: an interval for a window being watched,
   * and `visibilitychange`/`focus` for one that was buried behind other apps for days and should
   * be current by the time it's read. `shouldRecheck` owns both floors.
   */
  useEffect(() => {
    // While an attempt is in flight, `waitForRestart` is already polling every 2s; a second
    // poller would fight it for the phase.
    if (phase.kind === "applying") return;

    const consider = (becameVisible: boolean) => {
      if (document.hidden) return; // nobody is looking; the visibility handler will catch up
      if (
        !shouldRecheck({
          lastCheckedAt: status?.checkedAt ?? null,
          now: Date.now(),
          becameVisible,
        })
      ) {
        return;
      }
      void refresh();
    };

    const timer = setInterval(() => consider(false), TICK_MS);
    const onReveal = () => consider(true);
    document.addEventListener("visibilitychange", onReveal);
    window.addEventListener("focus", onReveal);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onReveal);
      window.removeEventListener("focus", onReveal);
    };
  }, [phase.kind, status?.checkedAt, refresh]);

  // Give the primary action its focus back, now that this phase has re-enabled it. Runs after
  // the commit on purpose: focusing it in the same tick would hit the element while it is still
  // the disabled, loading one, and do nothing. Only when focus is sitting on the document —
  // if anything else claimed it during the request, that's the user's business, not ours.
  useEffect(() => {
    if (!reclaimFocus.current || phase.kind === "applying") return;
    reclaimFocus.current = false;
    if (document.activeElement === document.body) primaryRef.current?.focus();
  }, [phase]);

  async function applyUpdate(force: boolean) {
    if (!status) return;
    const previous = lastRun.current;
    startApplying();
    setLogOpen(false);

    const res = await fetch("/api/updates/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => ({}))) ?? {}) as {
      error?: string;
      activeTasks?: number;
      alreadyRunning?: boolean;
    };
    // Same gate as the poll loop, for the same reason: this resumed after an await, and the
    // instance may be gone. React drops a state update on an unmounted component anyway, so this
    // buys consistency rather than a fix — but a reader shouldn't have to work out why one path
    // checks and the other doesn't.
    if (cancelled.current) return;

    if (res?.status === 409) {
      setPhase({
        kind: "blocked",
        count: taskCount(body.activeTasks),
        serverMessage: body.error ?? null,
      });
      return;
    }
    if (!res?.ok) {
      setPhase({
        kind: "failed",
        run: null,
        startError: body.error ?? (res ? null : NO_ANSWER_ERROR),
      });
      return;
    }
    // "Already updating" is an attempt we didn't start, so its own record is the news (above).
    void waitForRestart(status.current, body.alreadyRunning ? null : previous);
  }

  function checkAgain() {
    if (!status) return;
    startApplying();
    void waitForRestart(status.current, null);
  }

  function dismiss() {
    if (!status?.latest) return;
    localStorage.setItem(DISMISSED_KEY, status.latest);
    setDismissed(status.latest);
  }

  if (!status?.updateAvailable || !status.packaged) return null;
  // Dismissal is per-version: a newer release than the one you dismissed speaks up again.
  if (dismissed && status.latest && dismissed === status.latest) return null;

  /**
   * The message, when the bar is saying something other than "an update exists". Headline first,
   * because the state has to be readable before the button is.
   */
  const notice: Notice | null = (() => {
    switch (phase.kind) {
      case "blocked":
        return {
          tone: TONE.warn,
          Icon: TriangleAlert,
          ...blockedCopy(phase.count, phase.serverMessage),
          link: { href: "/tasks", label: "Review running tasks" },
        };
      case "failed":
        return {
          tone: TONE.danger,
          Icon: TriangleAlert,
          ...(phase.run
            ? failureCopy(phase.run, status.current)
            : startErrorCopy(phase.startError)),
        };
      case "stalled":
        return {
          tone: TONE.warn,
          Icon: TriangleAlert,
          ...stalledCopy(phase.answering),
          // No tail to show — the reader attaches one only to a *recorded* failure — but the
          // path is still the one thing a person can act on here.
          logPath: phase.logPath,
        };
      case "uptodate":
        // `ok`, not `info`: being current is the good outcome, and a check mark on an info wash
        // is the icon and the tone disagreeing about which one it is.
        return {
          tone: TONE.ok,
          Icon: Check,
          ...uptodateCopy(status.current),
        };
      default:
        return null;
    }
  })();

  /**
   * The primary action, always rendered in the same slot. That's deliberate: a state change that
   * replaced this button with a different element would drop keyboard focus to the document, and
   * the state changes here are all reached *by pressing it*.
   */
  const action: {
    label: string;
    variant: ButtonVariant;
    icon?: ReactNode;
    loading?: boolean;
    onClick: () => void;
  } = (() => {
    switch (phase.kind) {
      case "applying":
        return {
          label: "Updating…",
          variant: "primary",
          loading: true,
          onClick: () => {},
        };
      case "blocked":
        return {
          label: "Update anyway",
          // `danger`, not `warn`: the warn variant *is* `bg-warn-soft`, so on this bar's warn
          // wash the most consequential click in the component would be its faintest control —
          // and ending three live agent sessions is destructive, which is what danger means here.
          variant: "danger",
          icon: <TriangleAlert className="size-3.5" aria-hidden="true" />,
          onClick: () => applyUpdate(true),
        };
      case "failed":
        return {
          label: "Try again",
          variant: "primary",
          icon: <RotateCcw className="size-3.5" aria-hidden="true" />,
          onClick: () => applyUpdate(false),
        };
      case "stalled":
        return {
          label: "Check again",
          variant: "secondary",
          icon: <RotateCcw className="size-3.5" aria-hidden="true" />,
          onClick: checkAgain,
        };
      case "uptodate":
        return {
          label: "Dismiss",
          variant: "secondary",
          icon: <Check className="size-3.5" aria-hidden="true" />,
          onClick: dismiss,
        };
      default:
        return {
          label: "Update now",
          variant: "primary",
          icon: <ArrowUpCircle className="size-3.5" aria-hidden="true" />,
          onClick: () => applyUpdate(false),
        };
    }
  })();

  const Icon = notice?.Icon ?? ArrowUpCircle;
  // The × dismisses the version for good, so it's kept away from the one state whose whole point
  // is a decision — "Not now" is the escape there, and it comes back rather than going quiet.
  // It's also dropped where the primary action *is* Dismiss, rather than shipping the same
  // action twice in one bar.
  const showDismiss =
    phase.kind !== "applying" &&
    phase.kind !== "blocked" &&
    phase.kind !== "uptodate";

  return (
    <div
      className={`flex flex-wrap gap-x-3 gap-y-1.5 border-b px-4 py-2 text-sm sm:px-6 ${notice ? "items-start" : "items-center"} ${notice?.tone ?? TONE.info}`}
    >
      {/* Icon and message are one flex item, so the icon can't end up stranded on a line of its
          own when the message claims the full width.
          `min-w-40`, not `min-w-0`: with `flex-1` and no floor the message collapses to a sliver
          beside the shrink-0 buttons instead of letting them wrap — one word per line at 390px.
          Same trap, and the same fix, as `GettingStarted`'s rows. A state with a headline, a
          reason and a log panel needs more than that floor, so below `sm` it takes the whole
          first line and the actions wrap under it. */}
      <div
        className={`flex min-w-40 flex-1 gap-3 ${notice ? "basis-full items-start sm:basis-auto" : "items-center"}`}
      >
        <Icon
          className={`size-4 shrink-0 ${notice ? "mt-0.5" : ""}`}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <p aria-live="polite">
            {notice ? (
              // Two lines, not one sentence: the headline has to be readable *as* a state before
              // the explanation is read at all. Run together — which is how the refusal used to
              // read, tucked in beside other copy — the first click looks like it did nothing.
              <>
                <span className="block font-medium">{notice.headline}</span>
                <span className="block">
                  {notice.body}
                  {notice.link && (
                    <>
                      {" "}
                      <Link
                        href={notice.link.href}
                        className="font-medium underline underline-offset-2 hover:opacity-80"
                      >
                        {notice.link.label}
                      </Link>
                    </>
                  )}
                </span>
              </>
            ) : phase.kind === "applying" ? (
              <span className="text-fg-subtle">
                {`Updating to ${status.latest ?? "the latest release"}… the server restarts, and this page reconnects on its own.`}
              </span>
            ) : (
              <>
                <span className="font-medium">
                  Version {status.latest} is available
                </span>
                <span className="text-fg-subtle">
                  {" "}
                  — you&apos;re on {status.current}.
                </span>
              </>
            )}
          </p>

          {/* Where the attempt's output is, and — when it recorded a failure — what it said. */}
          {(notice?.logTail || notice?.logPath) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
              {notice.logTail && (
                <button
                  type="button"
                  onClick={() => setLogOpen((o) => !o)}
                  aria-expanded={logOpen}
                  aria-controls={logId}
                  className="inline-flex items-center gap-1 rounded font-medium underline underline-offset-2 hover:opacity-80"
                >
                  {logOpen ? (
                    <ChevronUp className="size-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                  )}
                  {logOpen ? "Hide the update log" : "Show the update log"}
                </button>
              )}
              {/* Wraps rather than truncating: `truncate` ellipsises the *end*, which on
                  `…/.control-center/logs/update.log` hides the filename and keeps the part you
                  could have guessed — and left only a `title` to read it, which the keyboard
                  and a screen reader can't reach. */}
              {notice.logPath && (
                <span className="min-w-0 font-mono break-all">
                  {notice.logPath}
                </span>
              )}
            </div>
          )}
          {/* Always rendered so `aria-controls` never dangles. Plain text in a `<pre>`: it's a
            log, so it is never markdown and never HTML. */}
          <div id={logId}>
            {logOpen && notice?.logTail && (
              <pre className="scroll-thin mt-1.5 max-h-48 overflow-auto rounded-lg border border-line bg-sunken p-3 font-mono text-xs whitespace-pre-wrap text-fg-muted">
                {notice.logTail}
              </pre>
            )}
          </div>
        </div>
      </div>

      <Button
        ref={primaryRef}
        size="sm"
        variant={action.variant}
        className="shrink-0"
        onClick={action.onClick}
        loading={action.loading}
        icon={action.icon}
      >
        {action.label}
      </Button>

      {phase.kind === "blocked" && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={() => {
            setPhase({ kind: "idle" });
            // This button is the only control here that unmounts on its own click, so it hands
            // focus on rather than dropping it to the document — the primary action is the same
            // element in every phase, which is exactly what makes it a safe place to land.
            primaryRef.current?.focus();
          }}
        >
          Not now
        </Button>
      )}

      {status.releaseUrl && (
        <a
          href={status.releaseUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
        >
          Release notes
        </a>
      )}

      {showDismiss && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={`Dismiss the update notice for version ${status.latest}`}
          className="shrink-0 rounded-lg p-1 text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg-strong"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
