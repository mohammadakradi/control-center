"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ClipboardList,
  Code2,
  CornerDownLeft,
  Command,
  Loader2,
  type LucideIcon,
  Palette,
  Play,
  Sparkles,
} from "lucide-react";
import { Avatar } from "@/components/AgentAvatar";
import { AttachmentPicker, mergeFiles } from "@/components/AttachmentPicker";
import { Select } from "@/components/ui/select";

type Cmd = {
  name: string;
  full: string;
  description?: string;
  argumentHint?: string;
};
type AgentLite = {
  id: string;
  namespace: string;
  name?: string | null;
  version?: string | null;
  description?: string | null;
  commands: Cmd[];
};

// Preferred command order for the SWE agent.
const SWE_ORDER = ["task", "fix", "review", "ship", "onboard", "workspace"];

const MODELS = [
  { value: "auto", label: "Auto (smart)" },
  { value: "sonnet", label: "Sonnet 4.6" },
  { value: "opus", label: "Opus 4.8" },
];

// Per-namespace presentation for the agent cards. Falls back gracefully for
// agents we don't recognize (the agent's own name/description).
const AGENT_META: Record<
  string,
  { icon: LucideIcon; name: string; tagline: string }
> = {
  swe: {
    icon: Code2,
    name: "Software Engineer",
    tagline: "End-to-end builds across the stack",
  },
  fe: {
    icon: Palette,
    name: "Frontend",
    tagline: "UI, components, and design polish",
  },
  pm: {
    icon: ClipboardList,
    name: "Project Manager",
    tagline: "Planning, specs, and task breakdown",
  },
};

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
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const cmd = commands.find((c) => c.name === command);
  const hasOnboard = (agent?.commands ?? []).some((c) => c.name === "onboard");
  // Nudge the user to onboard the selected agent before running other commands.
  const needsOnboard = !onboarded && hasOnboard && command !== "onboard";
  const modelLabel = MODELS.find((m) => m.value === model)?.label ?? model;
  // Live, human-readable echo of the slash command that will be dispatched.
  const resolved = agent
    ? `/${agent.namespace}:${command || "…"} on ${modelLabel}`
    : "";

  if (agents.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        No agents discovered. Install a Claude Code plugin first.
      </p>
    );
  }

  function selectAgent(a: AgentLite) {
    setAgentId(a.id);
    const ob = onboardedByAgent[a.id] ?? true;
    setCommand(orderCommands(a.namespace, a.commands, ob)[0]?.name ?? "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    // FormData so we can attach files; the API accepts both multipart and JSON.
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("agentId", agentId);
    fd.set("command", command);
    fd.set("requestText", requestText);
    fd.set("model", model);
    for (const f of files) fd.append("files", f);
    const res = await fetch("/api/tasks", { method: "POST", body: fd });
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
      {/* Step 1 — agent */}
      <Eyebrow>Agent</Eyebrow>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => {
          const meta = AGENT_META[a.namespace];
          const selected = a.id === agentId;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => selectAgent(a)}
              aria-pressed={selected}
              className={`group relative rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
                selected
                  ? "border-sky-500 bg-sky-500/10"
                  : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={`rounded-full ${selected ? "ring-2 ring-sky-500/60" : ""}`}
                >
                  <Avatar namespace={a.namespace} size={36} />
                </span>
                {selected && <Check className="size-4 text-sky-400" />}
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs text-neutral-500">
                /{a.namespace}
                {a.version && (
                  <span className="text-neutral-600">v{a.version}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-100">
                {meta?.icon && (
                  <meta.icon
                    className={`size-4 shrink-0 ${selected ? "text-sky-400" : "text-neutral-400"}`}
                  />
                )}
                <span className="truncate">
                  {meta?.name ?? a.name ?? `/${a.namespace}`}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-snug text-neutral-500">
                {meta?.tagline ?? a.description ?? ""}
              </div>
            </button>
          );
        })}
      </div>

      {/* Step 2 — workflow */}
      <Eyebrow>Workflow</Eyebrow>
      <div className="mb-2 flex flex-wrap gap-2">
        {commands.map((c) => {
          const selected = c.name === command;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => setCommand(c.name)}
              aria-pressed={selected}
              className={`rounded-lg border px-3 py-1.5 font-mono text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
                selected
                  ? "border-sky-500 bg-sky-500 text-white"
                  : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
              }`}
            >
              {c.name}
            </button>
          );
        })}
      </div>
      <p className="mb-6 min-h-10 max-w-2xl text-sm leading-snug text-neutral-400">
        {cmd?.description ?? " "}
      </p>

      {needsOnboard && (
        <div className="mb-6 -mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
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

      {/* Step 3 — prompt */}
      <Eyebrow>Prompt</Eyebrow>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const { files: merged, error: err } = mergeFiles(
            files,
            e.dataTransfer.files,
          );
          setFiles(merged);
          if (err) setError(err);
        }}
        className={`rounded-xl border bg-neutral-950 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20 ${
          dragging ? "border-sky-500 ring-2 ring-sky-500/20" : "border-neutral-700"
        }`}
      >
        <div className="relative">
          <span className="absolute top-3.5 left-4 font-mono text-sm text-sky-400/80">
            ❯
          </span>
          <textarea
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            placeholder={
              cmd?.argumentHint ??
              `What should /${agent?.namespace} ${command} do? Describe the work…`
            }
            rows={4}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                submit(e as unknown as React.FormEvent);
            }}
            className="min-h-24 w-full resize-y bg-transparent py-3 pr-4 pl-9 text-sm leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-600"
          />
        </div>

        {/* Footer: attachments on the left, model selector on the right. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 px-3 py-2">
          <div className="min-w-0 flex-1">
            <AttachmentPicker files={files} setFiles={setFiles} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-xs text-neutral-500">Model</span>
            <Select
              ariaLabel="Model"
              value={model}
              onChange={setModel}
              options={MODELS}
              placement="up"
            />
          </div>
        </div>
      </div>
      {model === "auto" && (
        <p className="mt-2 text-xs text-neutral-500">
          Auto picks Sonnet 4.6 for simple work and Opus 4.8 for complex tasks.
        </p>
      )}

      {/* Run row */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-linear-to-b from-sky-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {busy ? "Dispatching…" : "Run task"}
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
            <kbd className="inline-flex size-5 items-center justify-center rounded border border-neutral-700 bg-neutral-900">
              <Command className="size-3" />
            </kbd>
            <kbd className="inline-flex size-5 items-center justify-center rounded border border-neutral-700 bg-neutral-900">
              <CornerDownLeft className="size-3" />
            </kbd>
            to run
          </span>
        </div>

        {/* Live resolved command — keeps the slash-command model visible. */}
        {resolved && (
          <code className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1 font-mono text-xs text-neutral-400">
            {resolved}
          </code>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </form>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-xs font-medium tracking-wider text-neutral-500 uppercase">
      {children}
    </div>
  );
}
