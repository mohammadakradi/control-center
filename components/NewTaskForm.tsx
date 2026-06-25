"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Play, Sparkles } from "lucide-react";

type Cmd = {
  name: string;
  full: string;
  description?: string;
  argumentHint?: string;
};
type AgentLite = { id: string; namespace: string; commands: Cmd[] };

// Preferred command order for the SWE agent.
const SWE_ORDER = ["task", "fix", "review", "ship", "onboard", "workspace"];

/** Order an agent's commands: SWE follows a curated order, others keep theirs.
 *  Until the agent is onboarded on this project, its `onboard` command floats
 *  to the top so it's the obvious first step. */
function orderCommands(
  namespace: string | undefined,
  commands: Cmd[],
  onboarded: boolean,
): Cmd[] {
  let ordered = commands;
  if (namespace === "swe") {
    const rank = (n: string) => {
      const i = SWE_ORDER.indexOf(n);
      return i === -1 ? SWE_ORDER.length : i;
    };
    ordered = [...commands].sort(
      (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
    );
  }
  if (!onboarded) {
    const onboard = ordered.find((c) => c.name === "onboard");
    if (onboard)
      ordered = [onboard, ...ordered.filter((c) => c.name !== "onboard")];
  }
  return ordered;
}

function Select({
  value,
  onChange,
  className = "",
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none rounded-lg border border-neutral-700 bg-neutral-900 py-2 pr-9 pl-3 font-mono text-sm text-neutral-100 outline-none focus:border-sky-500 ${className}`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-neutral-500" />
    </div>
  );
}

export function NewTaskForm({
  projectId,
  agents,
  onboardedByAgent = {},
}: {
  projectId: string;
  agents: AgentLite[];
  /** Per-agent onboarding state for this project, keyed by agent id. */
  onboardedByAgent?: Record<string, boolean>;
}) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const agent = useMemo(
    () => agents.find((a) => a.id === agentId),
    [agents, agentId],
  );
  // Unknown agents (no marker defined) aren't gated.
  const onboarded = onboardedByAgent[agentId] ?? true;
  const commands = useMemo(
    () => orderCommands(agent?.namespace, agent?.commands ?? [], onboarded),
    [agent, onboarded],
  );
  const [command, setCommand] = useState(commands[0]?.name ?? "");
  const [requestText, setRequestText] = useState("");
  const [model, setModel] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cmd = commands.find((c) => c.name === command);
  const hasOnboard = (agent?.commands ?? []).some((c) => c.name === "onboard");
  // Nudge the user to onboard the selected agent before running other commands.
  const needsOnboard = !onboarded && hasOnboard && command !== "onboard";

  if (agents.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        No agents discovered. Install a Claude Code plugin first.
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, agentId, command, requestText, model }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Failed to dispatch task");
      return;
    }
    router.push(`/tasks/${body.id}`);
  }

  return (
    <form onSubmit={submit}>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={agentId}
          onChange={(v) => {
            const a = agents.find((x) => x.id === v);
            setAgentId(v);
            const ob = onboardedByAgent[v] ?? true;
            setCommand(
              orderCommands(a?.namespace, a?.commands ?? [], ob)[0]?.name ?? "",
            );
          }}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              /{a.namespace}
            </option>
          ))}
        </Select>
        <span className="font-mono text-base font-semibold text-sky-400">❯</span>
        <Select value={command} onChange={setCommand} className="min-w-48">
          {commands.map((c) => (
            <option key={c.name} value={c.name}>
              {c.full}
            </option>
          ))}
        </Select>
        <span className="text-xs text-neutral-600">on</span>
        <Select value={model} onChange={setModel}>
          <option value="auto">Auto (smart)</option>
          <option value="sonnet">Sonnet 4.6</option>
          <option value="opus">Opus 4.8</option>
        </Select>
      </div>
      {model === "auto" && (
        <p className="mt-2 text-xs text-neutral-500">
          Auto picks Sonnet 4.6 for simple work and Opus 4.8 for complex tasks.
        </p>
      )}

      {needsOnboard && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="min-w-0 flex-1">
            <span className="font-mono">/{agent?.namespace}</span> hasn&apos;t
            been onboarded on this project yet. Run{" "}
            <span className="font-mono">/{agent?.namespace}:onboard</span> first
            so it learns the codebase.
          </span>
          <button
            type="button"
            onClick={() => setCommand("onboard")}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/25"
          >
            <Sparkles className="size-3.5" />
            Onboard /{agent?.namespace}
          </button>
        </div>
      )}

      {cmd?.description && (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
          {cmd.description}
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20">
        <div className="relative">
          <span className="absolute top-3.5 left-4 font-mono text-sm text-sky-400/80">
            ❯
          </span>
          <textarea
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            placeholder={cmd?.argumentHint ?? "Describe the request (optional)"}
            rows={3}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                submit(e as unknown as React.FormEvent);
            }}
            className="min-h-24 w-full resize-y bg-transparent py-3 pr-4 pl-9 text-sm leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-600"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-gradient-to-b from-sky-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {busy ? "Dispatching…" : "Run task"}
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
          <kbd className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400">
            ⌘
          </kbd>
          <kbd className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400">
            ↵
          </kbd>
          to run
        </span>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </form>
  );
}
