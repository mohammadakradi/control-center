"use client";

import { useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { CardSection } from "@/components/ui-cards";
import { MODEL_CATALOG, modelInfo } from "@/lib/models";

/** Per-token price, so the reason a model is off by default is on screen rather than in a
 *  commit message — Fable at 2× Opus 5 explains itself. */
function priceNote(label: string): string {
  const m = modelInfo(label);
  return m ? `$${m.input} / $${m.output}` : "";
}

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
 * **Only the Sonnet 5 / Opus 5 generations start allowed.** Fable costs about twice what Opus 5
 * does, and when it was auto-routed here 17 runs cost $389 with no sign the escalation was
 * needed; a model added to the catalog later starts off too. Turning one on should be a
 * decision someone makes on purpose, per agent.
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

  // Grouped by family so eleven models read as four decisions, cheapest family first — the
  // same order the router clamps in.
  const families = [...new Set(MODEL_CATALOG.map((m) => m.family))].map((family) => ({
    family,
    models: initial.models.filter((m) => modelInfo(m)?.family === family),
  }));

  return (
    <CardSection title="Agent models">
      <p className="text-sm text-fg-subtle">
        Every Claude model this install can run, and which ones each agent may use. This applies
        to an explicit pick and to Auto — Auto only ever chooses from what you allow here. Prices
        are per million input / output tokens.
      </p>

      {namespaces.length === 0 ? (
        <p className="mt-4 text-sm text-fg-faint">
          No agents discovered yet. Install a Claude Code plugin first.
        </p>
      ) : (
        // Scrolls inside the card, never the page, when three agent columns don't fit a phone.
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[22rem] border-collapse text-sm">
            <caption className="sr-only">Models allowed per agent</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-faint">
                <th scope="col" className="py-2 pr-3 font-medium">Model</th>
                <th scope="col" className="py-2 pr-3 font-medium">Price</th>
                {namespaces.map((ns) => (
                  <th key={ns} scope="col" className="px-1 py-2 text-center font-mono font-medium">
                    /{ns}
                  </th>
                ))}
              </tr>
            </thead>
            {families.map(({ family, models }) => (
              <tbody key={family}>
                <tr>
                  <th
                    scope="rowgroup"
                    colSpan={2 + namespaces.length}
                    className="pb-1 pt-4 text-left text-xs font-medium uppercase tracking-wide text-fg-faint"
                  >
                    {family}
                  </th>
                </tr>
                {models.map((m) => (
                  <tr key={m} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-fg-strong">
                      {modelInfo(m)?.name ?? m}
                    </th>
                    <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs text-fg-faint">
                      {priceNote(m)}
                    </td>
                    {namespaces.map((ns) => {
                      const on = (policies[ns] ?? []).includes(m);
                      const pending = busy === `${ns}:${m}`;
                      return (
                        <td key={ns} className="px-1 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => toggle(ns, m)}
                            disabled={pending}
                            aria-pressed={on}
                            aria-label={`${modelInfo(m)?.name ?? m} for /${ns}`}
                            className={`inline-flex min-w-14 items-center justify-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                              on
                                ? "border-ok-line bg-ok-soft text-ok"
                                : "border-line bg-sunken text-fg-muted hover:text-fg-subtle"
                            }`}
                          >
                            {/* The check is redundant with colour on purpose — state must not
                                be conveyed by hue alone. `aria-pressed` carries it for
                                assistive tech. */}
                            {on && <Check className="size-3" aria-hidden />}
                            {on ? "On" : "Off"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
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
