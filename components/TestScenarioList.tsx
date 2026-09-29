"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, FlaskConical, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui-cards";
import { FeatureGroup, type FeatureLite } from "@/components/FeatureGroup";
import {
  SCENARIO_ORIGIN_LABEL,
  SCENARIO_STATUS_LABEL,
  scenarioStatusDot,
} from "@/lib/ui";
import type { TestScenario, TestScenarioStatus } from "@/lib/db/schema";

/** What a row needs — narrower than the database row, since a client component should not be
 *  handed columns it doesn't render. The body in particular is up to 128 kB of markdown and
 *  has no business crossing the wire for a list. */
export type ScenarioRow = Pick<
  TestScenario,
  | "id"
  | "title"
  | "status"
  | "origin"
  | "sourcePath"
  | "archivedPath"
  | "statusOverride"
  | "lastPassed"
  | "lastFailed"
>;

export type ScenarioGroupView = {
  featureId: string | null;
  featureName: string;
  scenarios: ScenarioRow[];
  openCount: number;
  passedCount: number;
  closedCount: number;
};

/**
 * A project's test scenarios, grouped by feature — what the fe, swe and qa agents wrote at
 * their report gates, and what is still unverified.
 *
 * Client-side because every action mutates and then needs the server's view again: closing a
 * scenario **moves its markdown** into `.qa/archive/`, so there is no honest optimistic render
 * of it — the file move can report `missing` (someone deleted it by hand) or `refused`, and a
 * row that showed "Closed" while the server said otherwise would be lying about a filesystem
 * change. Status is rendered straight from the server for the same reason `BacklogItemRow`
 * does: a QA run can move these rows from underneath us.
 *
 * Open scenarios are shown by default. Completed and closed ones are a fold rather than a
 * filter — they are the record of what has been verified, and hiding them permanently would
 * make "is this tested?" unanswerable from the page that owns the question.
 */
export function TestScenarioList({
  projectId,
  groups,
  features,
  warnings = [],
}: {
  projectId: string;
  groups: ScenarioGroupView[];
  /** Full feature rows keyed by id, so the shared heading can show the branch chip. A group
   *  whose feature is missing here renders as the ungrouped bucket. */
  features: Record<string, FeatureLite>;
  warnings?: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const totalOpen = groups.reduce((n, g) => n + g.openCount, 0);
  const totalDone = groups.reduce((n, g) => n + g.passedCount + g.closedCount, 0);

  async function call(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        headers: { "content-type": "application/json" },
        ...init,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `That didn't work (${res.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (s: ScenarioRow, status: TestScenarioStatus) =>
    call(s.id, `/api/projects/${projectId}/test-scenarios/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });

  const closeGroup = (featureId: string | null) =>
    call(`g:${featureId ?? "none"}`, `/api/projects/${projectId}/test-scenarios/close-group`, {
      method: "POST",
      body: JSON.stringify({ featureId }),
    });

  if (groups.length === 0) {
    return (
      <p className="py-2 text-sm text-fg-subtle">
        No test scenarios yet. The fe and swe agents write one at the end of each task, and{" "}
        <span className="font-mono text-xs text-accent">/qa:scenario</span> authors them
        directly — they are read from{" "}
        <span className="font-mono text-xs">.qa/scenarios/</span>,{" "}
        <span className="font-mono text-xs">.fe/test-scenarios/</span> and{" "}
        <span className="font-mono text-xs">.swe/test-scenarios/</span>.
      </p>
    );
  }

  return (
    <div>
      {warnings.length > 0 && (
        <ul className="mb-3 space-y-1 text-xs text-warn">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mb-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {totalDone > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-xs text-fg-faint">
            {totalOpen} open · {totalDone} completed or closed
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDone((v) => !v)}
            aria-pressed={showDone}
          >
            {showDone ? "Hide completed" : "Show completed"}
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {groups.map((group) => {
          const visible = showDone
            ? group.scenarios
            : group.scenarios.filter((s) => s.status === "open");
          if (visible.length === 0) return null;
          const groupKey = `g:${group.featureId ?? "none"}`;

          return (
            <FeatureGroup
              key={group.featureId ?? "ungrouped"}
              feature={group.featureId ? (features[group.featureId] ?? null) : null}
              count={visible.length}
              unit="scenario"
              action={
                group.openCount > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === groupKey}
                    disabled={busy !== null}
                    onClick={() => closeGroup(group.featureId)}
                    title={`Close all ${group.openCount} open scenarios in this group. Their markdown is archived, not deleted.`}
                  >
                    <CheckCheck className="size-3.5" aria-hidden="true" />
                    Close all {group.openCount}
                  </Button>
                ) : undefined
              }
            >
              <ul className="mt-2 space-y-2">
                {visible.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-line bg-surface-2 px-3.5 py-3"
                  >
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${scenarioStatusDot(s.status)}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium break-words text-fg-strong">
                        {s.title}
                      </div>
                      <div className="mt-1 font-mono text-xs break-all text-fg-faint">
                        {s.archivedPath ?? s.sourcePath}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        {/* Every chip carries a word as well as a tone, so nothing here is
                            conveyed by colour alone. */}
                        <Chip
                          tone={
                            s.status === "passed"
                              ? "ok"
                              : s.status === "closed"
                                ? "muted"
                                : "info"
                          }
                        >
                          {SCENARIO_STATUS_LABEL[s.status]}
                        </Chip>
                        <Chip title={`Written by the ${s.origin} agent`}>
                          {SCENARIO_ORIGIN_LABEL[s.origin]}
                        </Chip>
                        {(s.lastPassed > 0 || s.lastFailed > 0) && (
                          <Chip
                            tone={s.lastFailed > 0 ? "warn" : "ok"}
                            title="Steps recorded by the last /qa:test run."
                          >
                            {`${s.lastPassed} passed · ${s.lastFailed} failed`}
                          </Chip>
                        )}
                        {s.statusOverride && (
                          <Chip title="You set this status by hand, so a later passing run will not change it.">
                            set by hand
                          </Chip>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {s.status === "open" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busy === s.id}
                          disabled={busy !== null}
                          onClick={() => setStatus(s, "closed")}
                          title="Close this scenario. Its markdown is archived under .qa/archive/, not deleted."
                        >
                          <X className="size-3.5" aria-hidden="true" />
                          Close
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busy === s.id}
                          disabled={busy !== null}
                          onClick={() => setStatus(s, "open")}
                          title="Reopen this scenario and restore its markdown to where it was."
                        >
                          <RotateCcw className="size-3.5" aria-hidden="true" />
                          Reopen
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </FeatureGroup>
          );
        })}
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-fg-faint">
        <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Run one with{" "}
          <span className="font-mono text-accent">/qa:test &lt;path&gt;</span> — a run that
          passes every step marks the scenario completed and archives its markdown. Closing
          never deletes a file.
        </span>
      </p>
    </div>
  );
}
