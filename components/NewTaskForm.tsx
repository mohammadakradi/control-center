"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ClipboardList,
  Code2,
  CornerDownLeft,
  Command,
  type LucideIcon,
  Palette,
  Play,
  Sparkles,
} from "lucide-react";
import { Avatar } from "@/components/AgentAvatar";
import { AttachmentPicker, FileDropZone } from "@/components/AttachmentPicker";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { orderSkills } from "@/lib/ui";

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

const MODELS = [
  { value: "auto", label: "Auto (smart)" },
  { value: "fable-5", label: "Fable 5" },
  { value: "opus-5", label: "Opus 5" },
  { value: "sonnet-5", label: "Sonnet 5" },
];

/** What "Auto" routes to, per agent (mirrors runner/model-router.ts). */
function autoHint(namespace?: string): string {
  if (namespace === "pm")
    return "Auto picks Fable 5 for very complex planning, otherwise Sonnet 5.";
  return "Auto picks Fable 5 for very complex tasks, Opus 5 for complex work, and Sonnet 5 for simple changes.";
}

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
  // `onboard` is dropped from the list once it's done — but CLAUDE.md and the design-system
  // notes go stale, so "Re-onboard" puts it back rather than making a refresh unreachable.
  const [reonboard, setReonboard] = useState(false);
  const commands = useMemo(
    () => orderSkills(agent?.namespace, agent?.commands ?? [], onboarded && !reonboard),
    [agent, onboarded, reonboard],
  );
  const [command, setCommand] = useState(commands[0]?.name ?? "");
  const [requestText, setRequestText] = useState("");
  const [model, setModel] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when dispatch was refused because this user has no Anthropic token — the
  // error then carries a link to Settings instead of being a dead end.
  const [needsToken, setNeedsToken] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

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
      <p className="text-sm text-fg-subtle">
        No agents discovered. Install a Claude Code plugin first.
      </p>
    );
  }

  function selectAgent(a: AgentLite) {
    setAgentId(a.id);
    setReonboard(false); // a per-agent choice — don't carry it to the next one
    const ob = onboardedByAgent[a.id] ?? true;
    setCommand(orderSkills(a.namespace, a.commands, ob)[0]?.name ?? "");
  }

  /** Reveal `onboard` again and select it. */
  function startReonboard() {
    setReonboard(true);
    setCommand("onboard");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNeedsToken(false);
    // FormData so we can attach files; the API accepts both multipart and JSON.
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("agentId", agentId);
    fd.set("command", command);
    fd.set("requestText", requestText);
    fd.set("model", model);
    for (const f of files) fd.append("files", f);
    // A rejected fetch (server restarted, upload cut off) used to escape this function
    // entirely, leaving the button spinning on "Dispatching…" for good with nothing said —
    // indistinguishable, from the outside, from the app ignoring you.
    let res: Response;
    try {
      res = await fetch("/api/tasks", { method: "POST", body: fd });
    } catch {
      setBusy(false);
      setError("Couldn't reach the server. Check it's still running and try again.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? `Failed to dispatch task (HTTP ${res.status}).`);
      setNeedsToken(Boolean(body.needsToken));
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
              className={`group relative rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                selected
                  ? "border-accent bg-info-soft"
                  : "border-line bg-surface-2 hover:border-line-strong"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={`rounded-full ${selected ? "ring-2 ring-ring/60" : ""}`}
                >
                  <Avatar namespace={a.namespace} size={36} />
                </span>
                {selected && <Check className="size-4 text-accent" />}
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs text-fg-faint">
                /{a.namespace}
                {a.version && (
                  <span className="text-fg-faint">v{a.version}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-fg-strong">
                {meta?.icon && (
                  <meta.icon
                    className={`size-4 shrink-0 ${selected ? "text-accent" : "text-fg-subtle"}`}
                  />
                )}
                <span className="truncate">
                  {meta?.name ?? a.name ?? `/${a.namespace}`}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-snug text-fg-faint">
                {meta?.tagline ?? a.description ?? ""}
              </div>
            </button>
          );
        })}
      </div>

      {/* Step 2 — skill */}
      <Eyebrow>Skill</Eyebrow>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {commands.map((c) => {
          const selected = c.name === command;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => setCommand(c.name)}
              aria-pressed={selected}
              className={`rounded-lg border px-3 py-1.5 font-mono text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                selected
                  ? "border-accent bg-accent text-accent-contrast"
                  : "border-line-strong bg-surface-2 text-fg-subtle hover:bg-surface-3 hover:text-fg"
              }`}
            >
              {c.name}
            </button>
          );
        })}
        {/* Onboarding is done, so it's out of the row — but a project's notes go stale, and
            this is the only way back to it. */}
        {onboarded && hasOnboard && !reonboard && (
          <button
            type="button"
            onClick={startReonboard}
            className="rounded-lg px-2 py-1.5 text-xs text-fg-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Re-onboard /{agent?.namespace}
          </button>
        )}
      </div>
      <p className="mb-6 min-h-10 max-w-2xl text-sm leading-snug text-fg-subtle">
        {cmd?.description ?? " "}
      </p>

      {needsOnboard && (
        <div className="mb-6 -mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn">
          <span className="min-w-0 flex-1">
            <span className="font-mono">/{agent?.namespace}</span> hasn&apos;t
            been onboarded on this project yet. Run{" "}
            <span className="font-mono">/{agent?.namespace}:onboard</span> first
            so it learns the codebase.
          </span>
          <Button
            variant="warn"
            size="sm"
            onClick={() => setCommand("onboard")}
            icon={<Sparkles className="size-3.5" aria-hidden="true" />}
          >
            Onboard /{agent?.namespace}
          </Button>
        </div>
      )}

      {/* Step 3 — prompt */}
      <Eyebrow>Prompt</Eyebrow>
      <FileDropZone
        files={files}
        setFiles={setFiles}
        onError={(msg) => msg && setError(msg)}
        className="rounded-xl border bg-sunken focus-within:border-accent focus-within:ring-2 focus-within:ring-ring/25"
      >
        <div className="relative">
          <span className="absolute top-3.5 left-4 font-mono text-sm text-accent">
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
            className="min-h-24 w-full resize-y bg-transparent py-3 pr-4 pl-9 text-sm leading-relaxed text-fg-strong outline-none placeholder:text-fg-faint"
          />
        </div>

        {/* Footer: attachments on the left, model selector on the right. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2">
          <div className="min-w-0 flex-1">
            <AttachmentPicker files={files} setFiles={setFiles} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-xs text-fg-faint">Model</span>
            <Select
              ariaLabel="Model"
              value={model}
              onChange={setModel}
              options={MODELS}
              placement="up"
            />
          </div>
        </div>
      </FileDropZone>
      {model === "auto" && (
        <p className="mt-2 text-xs text-fg-faint">{autoHint(agent?.namespace)}</p>
      )}

      {/* Run row */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            icon={<Play className="size-4" />}
            className="font-semibold"
          >
            {busy ? "Dispatching…" : "Run task"}
          </Button>
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-faint">
            <kbd className="inline-flex size-5 items-center justify-center rounded border border-line-strong bg-surface-2">
              <Command className="size-3" />
            </kbd>
            <kbd className="inline-flex size-5 items-center justify-center rounded border border-line-strong bg-surface-2">
              <CornerDownLeft className="size-3" />
            </kbd>
            to run
          </span>
        </div>

        {/* Live resolved command — keeps the slash-command model visible. */}
        {resolved && (
          <code
            aria-live="polite"
            className="rounded-md border border-line bg-sunken px-2.5 py-1 font-mono text-xs text-fg-subtle"
          >
            {resolved}
          </code>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
          {needsToken && (
            <>
              {" "}
              <Link href="/settings" className="font-medium underline">
                Open Settings
              </Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-xs font-medium tracking-wider text-fg-faint uppercase">
      {children}
    </div>
  );
}
