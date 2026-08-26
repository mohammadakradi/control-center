"use client";

import { useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { CardSection } from "@/components/ui-cards";
import { MODEL_DISPLAY } from "@/lib/ui";

/** Relative price per model, so the reason a model is off by default is on screen rather than
 *  in a commit message. Kept as prose, not numbers pulled from an API — it only has to convey
 *  the ordering that makes the decision obvious. */
const PRICE_NOTE: Record<string, string> = {
  "sonnet-5": "cheapest",
  "opus-5": "mid",
  "fable-5": "2× Opus 5",
};

export type AgentModelPolicy = {
  models: string[];
  policies: Record<string, string[]>;
};

/**
 * Which models each installed agent may run on.
 *
 * Install-wide, matching how an agent is already treated everywhere else — a shared installed
 * plugin, not one person's setting. The dispatcher enforces this independently, so a stale tab
 * can only ever produce a clear refusal, never a run on a denied model.
 *
 * **Fable 5 starts denied for every agent.** It costs about twice what Opus 5 does, and when it
 * was auto-routed here 17 runs cost $389 with no sign the escalation was needed. Turning that
 * back on should be a decision someone makes on purpose, per agent.
 */
export function AgentModelSettings({ initial }: { initial: AgentModelPolicy }) {
  const [policies, setPolicies] = useState(initial.policies);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const namespaces = Object.keys(policies).sort();

  async function toggle(namespace: string, model: string) {
    const current = policies[namespace] ?? [];
    const next = current.includes(model)
      ? current.filter((m) => m !== model)
      : [...initial.models.filter((m) => current.includes(m) || m === model)];

    // Refused in the UI as well as the API: an agent with nothing allowed would still run
    // (the resolver keeps it on the cheapest model) which makes an empty state look like it
    // saved something it didn't.
    if (next.length === 0) {
      setError(`The ${namespace} agent needs at least one allowed model.`);
      return;
    }

    setError(null);
    setBusy(`${namespace}:${model}`);
    // Optimistic: the toggle is the kind of control that feels broken if it lags, and the
    // failure path below puts the old value straight back.
    setPolicies((p) => ({ ...p, [namespace]: next }));
    try {
      const res = await fetch("/api/settings/agent-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ namespace, models: next }),
      });
      const body = (await res.json()) as { models?: string[]; error?: string };
      if (!res.ok) {
        setPolicies((p) => ({ ...p, [namespace]: current }));
        setError(body.error ?? "Could not save that change.");
      } else if (body.models) {
        // Trust the server's version over the optimistic one — it dropped anything unknown.
        setPolicies((p) => ({ ...p, [namespace]: body.models! }));
      }
    } catch {
      setPolicies((p) => ({ ...p, [namespace]: current }));
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <CardSection title="Agent models">
      <p className="text-sm text-fg-subtle">
        Which models each agent is allowed to run on. This applies to an explicit pick and to
        Auto — Auto only ever chooses from what you allow here.
      </p>

      {namespaces.length === 0 ? (
        <p className="mt-4 text-sm text-fg-faint">
          No agents discovered yet. Install a Claude Code plugin first.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {namespaces.map((ns) => {
            const allowed = policies[ns] ?? [];
            return (
              <div key={ns} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="w-14 shrink-0 font-mono text-sm text-fg-strong">/{ns}</span>
                <div className="flex flex-wrap gap-2">
                  {initial.models.map((m) => {
                    const on = allowed.includes(m);
                    const pending = busy === `${ns}:${m}`;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggle(ns, m)}
                        disabled={pending}
                        aria-pressed={on}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
                          on
                            ? "border-ok-line bg-ok-soft text-ok"
                            : "border-line bg-sunken text-fg-muted hover:text-fg-subtle"
                        }`}
                      >
                        {/* The check is redundant with colour on purpose — state must not be
                            conveyed by hue alone. `aria-pressed` carries it for assistive tech. */}
                        {on && <Check className="size-3" aria-hidden />}
                        {MODEL_DISPLAY[m] ?? m}
                        <span className="text-fg-faint">· {PRICE_NOTE[m] ?? ""}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="mt-4 flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </CardSection>
  );
}
