"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIVE_STATUSES, STATUS_LABEL } from "@/lib/ui";
import { StatusBadge } from "@/components/StatusBadge";

type StreamEvent = { id?: number; type: string; payload: unknown; ts: number };
type Gate = { gate: "proposal" | "report"; summary: string };

type Block = {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};
type SdkMsg = { type?: string; message?: { content?: unknown } };

type ToolCall = {
  name: string;
  detail?: string;
  id?: string;
  result?: string;
  isError?: boolean;
};
type ToolResult = { id: string; text: string; isError: boolean };

/** The agent's intermediate work (vs. milestones the user must act on). */
const isActivity = (b: Bubble) => b.kind === "assistant" || b.kind === "log";

type Bubble =
  | { kind: "assistant"; text: string; tools: ToolCall[] }
  | { kind: "user"; text: string }
  | { kind: "log"; text: string }
  | { kind: "gate"; gate: Gate };

function blocks(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]) : [];
}
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return blocks(content)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}
/** Pull a human-readable argument out of a tool_use input (e.g. the bash command). */
function toolDetail(name: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
  switch (name) {
    case "Bash":
      return str(input.command);
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return str(input.file_path);
    case "Glob":
      return str(input.pattern);
    case "Grep":
      return [str(input.pattern), str(input.path)].filter(Boolean).join("  ") || undefined;
    case "WebFetch":
      return str(input.url);
    case "Task":
    case "Agent":
      return str(input.description) ?? str(input.prompt);
    default:
      return str(Object.values(input).find((v) => typeof v === "string"));
  }
}
function toolsOf(content: unknown): ToolCall[] {
  return blocks(content)
    .filter((b) => b.type === "tool_use")
    .map((b) => {
      const name = b.name ?? "tool";
      return { name, detail: toolDetail(name, b.input), id: b.id };
    });
}
function isToolResultOnly(content: unknown): boolean {
  const bs = blocks(content);
  return bs.length > 0 && bs.every((b) => b.type === "tool_result");
}

const RESULT_CAP = 4000;
function resultText(content: unknown): string {
  let text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((b) =>
              typeof b === "string"
                ? b
                : (b as Block)?.type === "text"
                  ? ((b as Block).text ?? "")
                  : "",
            )
            .join("")
        : "";
  text = text.trimEnd();
  return text.length > RESULT_CAP ? `${text.slice(0, RESULT_CAP)}\n…(truncated)` : text;
}
/** tool_result blocks (carried in a following user message), keyed by tool_use_id. */
function toolResultsOf(content: unknown): ToolResult[] {
  return blocks(content)
    .filter((b) => b.type === "tool_result")
    .map((b) => ({
      id: b.tool_use_id ?? "",
      text: resultText(b.content),
      isError: Boolean(b.is_error),
    }))
    .filter((r) => r.id);
}
/** Attach incoming tool results onto the matching tool calls in prior bubbles. */
function attachResults(prev: Bubble[], results: ToolResult[]): Bubble[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return prev.map((b) => {
    if (b.kind !== "assistant") return b;
    let changed = false;
    const tools = b.tools.map((t) => {
      const r = t.id ? byId.get(t.id) : undefined;
      if (!r) return t;
      changed = true;
      return { ...t, result: r.text, isError: r.isError };
    });
    return changed ? { ...b, tools } : b;
  });
}

/** Fold a raw event into the transcript (returns a bubble or null to ignore). */
function eventToBubble(e: StreamEvent): Bubble | null {
  switch (e.type) {
    case "message": {
      const m = e.payload as SdkMsg;
      if (m?.type === "assistant") {
        const text = textOf(m.message?.content);
        const tools = toolsOf(m.message?.content);
        if (!text && tools.length === 0) return null;
        return { kind: "assistant", text, tools };
      }
      if (m?.type === "user") {
        if (isToolResultOnly(m.message?.content)) return null;
        const text = textOf(m.message?.content);
        return text ? { kind: "user", text } : null;
      }
      return null;
    }
    case "gate":
      return { kind: "gate", gate: e.payload as Gate };
    case "log":
      return { kind: "log", text: (e.payload as { message?: string })?.message ?? "" };
    default:
      return null;
  }
}

function partialText(e: StreamEvent): string {
  const ev = (e.payload as { event?: { type?: string; delta?: { type?: string; text?: string } } })?.event;
  if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta")
    return ev.delta.text ?? "";
  return "";
}

export function TaskLiveView({
  taskId,
  runnerUrl,
  initialStatus,
}: {
  taskId: string;
  runnerUrl: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const [gate, setGate] = useState<Gate | null>(null);
  const [live, setLive] = useState("");
  const [feedback, setFeedback] = useState("");
  const [connected, setConnected] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const lastId = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const active = ACTIVE_STATUSES.has(status);

  // Milestones (proposals, reports, approvals) are always shown; the agent's
  // intermediate work (prose, tool calls, logs) is hidden behind a toggle.
  const visible = showActivity ? bubbles : bubbles.filter((b) => !isActivity(b));
  const hiddenCount = bubbles.length - visible.length;

  const handle = useCallback((e: StreamEvent) => {
    if (e.id !== undefined) lastId.current = e.id;
    if (e.type === "partial") {
      const t = partialText(e);
      if (t) setLive((s) => s + t);
      return;
    }
    if (e.type === "status") {
      const s = (e.payload as { status: string }).status;
      setStatus(s);
      if (
        ["building", "committing", "done", "failed", "cancelled"].includes(s)
      )
        setGate(null);
      return;
    }
    if (e.type === "end") {
      setStatus((e.payload as { status?: string })?.status ?? "done");
      setGate(null);
      return;
    }
    if (e.type === "gate") {
      setGate(e.payload as Gate);
    }
    if (e.type === "message") {
      setLive(""); // final message supersedes live tokens
      const m = e.payload as SdkMsg;
      if (m?.type === "user") {
        const results = toolResultsOf(m.message?.content);
        if (results.length)
          setBubbles((prev) => attachResults(prev, results));
      }
    }
    const b = eventToBubble(e);
    if (b) setBubbles((prev) => [...prev, b]);
  }, []);

  // SSE connection (reconnects while the task is active).
  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    const connect = () => {
      es = new EventSource(
        `${runnerUrl}/tasks/${taskId}/stream?after=${lastId.current}`,
      );
      es.onopen = () => setConnected(true);
      es.onmessage = (ev) => {
        try {
          handle(JSON.parse(ev.data) as StreamEvent);
        } catch {
          /* ignore */
        }
      };
      es.addEventListener("closed", () => {
        es?.close();
        setConnected(false);
      });
      es.onerror = () => {
        es?.close();
        setConnected(false);
        if (!stopped) setTimeout(connect, 1500); // retry
      };
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [taskId, runnerUrl, handle]);

  // Autoscroll.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [bubbles, live, showActivity]);

  async function respond(allow: boolean) {
    const fb = feedback.trim() || undefined;
    setGate(null);
    setFeedback("");
    const note = allow
      ? fb
        ? `✓ Approved with changes: ${fb}`
        : "✓ Approved"
      : `✗ Rejected${fb ? `: ${fb}` : " — revise and present again"}`;
    setBubbles((prev) => [...prev, { kind: "user", text: note }]);
    await fetch(`${runnerUrl}/tasks/${taskId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allow, feedback: fb }),
    });
  }

  async function stop() {
    await fetch(`${runnerUrl}/tasks/${taskId}/stop`, { method: "POST" });
    router.refresh();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          <span className="text-xs text-neutral-500">
            {connected ? "● live" : active ? "○ reconnecting…" : "○ ended"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowActivity((v) => !v)}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {showActivity
              ? "Hide agent activity"
              : `Show agent activity${hiddenCount ? ` (${hiddenCount})` : ""}`}
          </button>
          {active && (
            <button
              onClick={stop}
              className="rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/50"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      <div
        ref={scroller}
        className="scroll-thin h-[55vh] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-4"
      >
        {visible.length === 0 && (!showActivity || !live) && (
          <p className="text-sm text-neutral-500">
            {active
              ? "Agent is working… proposals, approvals and reports will appear here."
              : "Waiting for the agent…"}
          </p>
        )}
        <div className="space-y-3">
          {visible.map((b, i) => (
            <BubbleView key={i} bubble={b} />
          ))}
          {showActivity && live && (
            <div className="whitespace-pre-wrap text-sm text-neutral-300">
              {live}
              <span className="ml-0.5 animate-pulse">▍</span>
            </div>
          )}
        </div>
      </div>

      {gate && (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-lg">🚦</span>
            <h3 className="font-medium text-amber-200">
              {gate.gate === "proposal"
                ? "Proposal — approve to start building"
                : "Change report — approve to commit"}
            </h3>
          </div>
          <pre className="mb-3 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-950/60 p-3 text-sm text-neutral-200">
            {gate.summary}
          </pre>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Optional feedback (sent with Approve-with-changes or Reject)"
            rows={2}
            className="mb-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-amber-500"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => respond(true)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              {feedback.trim() ? "Approve with changes" : "Approve"}
            </button>
            <button
              onClick={() => respond(false)}
              className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-300 hover:bg-red-950/50"
            >
              Reject &amp; revise
            </button>
          </div>
        </div>
      )}

      {!active && (
        <p className="mt-4 text-sm text-neutral-400">
          Task {STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}.
        </p>
      )}
    </div>
  );
}

function BubbleView({ bubble }: { bubble: Bubble }) {
  if (bubble.kind === "log")
    return (
      <p className="font-mono text-xs text-neutral-500">— {bubble.text}</p>
    );
  if (bubble.kind === "gate")
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-amber-300">
          <span>🚦</span>
          {bubble.gate.gate === "proposal" ? "Proposal" : "Change report"}
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm text-neutral-200">
          {bubble.gate.summary}
        </pre>
      </div>
    );
  if (bubble.kind === "user")
    return (
      <div className="ml-8 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-300">
        {bubble.text}
      </div>
    );
  return (
    <div className="rounded-lg bg-neutral-900/40 px-3 py-2">
      {bubble.text && (
        <p className="whitespace-pre-wrap text-sm text-neutral-200">
          {bubble.text}
        </p>
      )}
      {bubble.tools.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {bubble.tools.map((t, i) => (
            <div key={i}>
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-xs text-sky-300">
                {t.name}
              </span>
              {t.detail && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950/70 px-2 py-1 font-mono text-xs text-neutral-400">
                  {t.detail}
                </pre>
              )}
              {t.result && (
                <pre
                  className={`mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded px-2 py-1 font-mono text-xs ${
                    t.isError
                      ? "bg-red-950/40 text-red-300"
                      : "bg-neutral-900/60 text-neutral-500"
                  }`}
                >
                  {t.result}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
