"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Play } from "lucide-react";

type Cmd = {
  name: string;
  full: string;
  description?: string;
  argumentHint?: string;
};
type AgentLite = { id: string; namespace: string; commands: Cmd[] };

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
}: {
  projectId: string;
  agents: AgentLite[];
}) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const agent = useMemo(
    () => agents.find((a) => a.id === agentId),
    [agents, agentId],
  );
  const [command, setCommand] = useState(agent?.commands[0]?.name ?? "");
  const [requestText, setRequestText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cmd = agent?.commands.find((c) => c.name === command);

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
      body: JSON.stringify({ projectId, agentId, command, requestText }),
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
            setCommand(a?.commands[0]?.name ?? "");
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
          {agent?.commands.map((c) => (
            <option key={c.name} value={c.name}>
              {c.full}
            </option>
          ))}
        </Select>
      </div>

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
