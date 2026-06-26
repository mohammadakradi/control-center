"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  FileText,
  ImageIcon,
  ListTree,
  MessageSquare,
  RotateCcw,
  Send,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { ACTIVE_STATUSES, STATUS_LABEL, reportHasFindings } from "@/lib/ui";
import { AttachmentPicker } from "@/components/AttachmentPicker";
import { StatusBadge } from "@/components/StatusBadge";
import { Markdown } from "@/components/Markdown";
import { FileModal } from "@/components/FileModal";

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

type Attachment = { name: string; type: string };
type Bubble =
  | { kind: "request"; text: string; attachments: Attachment[] }
  | { kind: "assistant"; text: string; tools: ToolCall[] }
  | { kind: "report"; text: string }
  | { kind: "decision"; text: string; allow: boolean }
  | { kind: "user"; text: string }
  | { kind: "log"; text: string }
  | { kind: "gate"; gate: Gate };

/** The agent's intermediate work (vs. milestones the user acts on: the request, proposals,
 *  reports, approvals, and the user's own follow-up messages — all always shown). */
const isActivity = (b: Bubble) =>
  b.kind === "assistant" || b.kind === "log";

// Markers the agent prints (see GATE_PROMPT). `[[DONE]]` ends the final summary;
// proposals/reports normally arrive as `gate` events via the approval tool.
// Only a TRAILING marker is a real signal — matching it anywhere misfires when
// the agent quotes the marker in prose (e.g. "tasks without `[[DONE]]`…").
const DONE_AT_END = /\[\[DONE\]\]\s*$/;
const ALL_MARKERS = ["[[DONE]]", "[[GATE:PROPOSAL]]", "[[GATE:REPORT]]"];
const stripMarkers = (text: string) =>
  ALL_MARKERS.reduce((t, m) => t.split(m).join(""), text).trim();

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
        // The final summary (ends with [[DONE]]) is the report the user should see.
        if (DONE_AT_END.test(text)) {
          const clean = stripMarkers(text);
          return clean ? { kind: "report", text: clean } : null;
        }
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

/** Fold persisted events into initial transcript state (server-rendered, so a completed
 *  task shows its proposal/report even if the live daemon is unreachable). Mirrors handle(). */
function seedFromEvents(
  events: StreamEvent[],
  fallbackStatus: string,
  request?: { text: string; attachments: Attachment[] },
) {
  // The original request always pins to the top of the transcript.
  let bubbles: Bubble[] =
    request && (request.text.trim() || request.attachments.length)
      ? [{ kind: "request", text: request.text, attachments: request.attachments }]
      : [];
  let status = fallbackStatus;
  let gate: Gate | null = null;
  let lastId = 0;
  for (const e of events) {
    if (e.id !== undefined) lastId = e.id;
    if (e.type === "status") {
      const s = (e.payload as { status: string }).status;
      status = s;
      if (["building", "committing", "done", "failed", "cancelled"].includes(s)) gate = null;
    } else if (e.type === "end") {
      status = (e.payload as { status?: string })?.status ?? "done";
      gate = null;
    } else if (e.type === "gate") {
      gate = e.payload as Gate;
    }
    if (e.type === "message") {
      const m = e.payload as SdkMsg;
      if (m?.type === "user") {
        const results = toolResultsOf(m.message?.content);
        if (results.length) bubbles = attachResults(bubbles, results);
      }
    }
    const b = eventToBubble(e);
    if (b) bubbles.push(b);
  }
  return { bubbles, status, gate, lastId };
}

export function TaskLiveView({
  taskId,
  runnerUrl,
  initialStatus,
  initialEvents = [],
  request,
  projectId,
  agentId,
}: {
  taskId: string;
  runnerUrl: string;
  initialStatus: string;
  /** Persisted events, server-rendered so the transcript shows without the live daemon. */
  initialEvents?: StreamEvent[];
  /** The original request (text + attachments), pinned to the top of the transcript. */
  request?: { text: string; attachments: Attachment[] };
  projectId: string;
  agentId: string;
}) {
  const router = useRouter();
  // Seed from server-rendered persisted events (computed once on mount).
  const [seed] = useState(() => seedFromEvents(initialEvents, initialStatus, request));
  const [bubbles, setBubbles] = useState<Bubble[]>(seed.bubbles);
  const [status, setStatus] = useState(seed.status);
  const [gate, setGate] = useState<Gate | null>(seed.gate);
  const [live, setLive] = useState("");
  const [feedback, setFeedback] = useState("");
  const [connected, setConnected] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const lastId = useRef(seed.lastId);
  const scroller = useRef<HTMLDivElement>(null);

  const active = ACTIVE_STATUSES.has(status);

  // Milestones (proposals, reports, approvals) are always shown; the agent's
  // intermediate work (prose, tool calls, logs) is hidden behind a toggle.
  const visible = showActivity ? bubbles : bubbles.filter((b) => !isActivity(b));
  const hiddenCount = bubbles.length - visible.length;

  // The currently-pending gate (matches the latest gate bubble) renders inline
  // as an interactive card; once resolved it falls back to a static record.
  const isPendingGate = (b: Bubble) =>
    b.kind === "gate" &&
    !!gate &&
    b.gate.gate === gate.gate &&
    b.gate.summary === gate.summary;

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
  }, [taskId, runnerUrl, handle, reconnectKey]);

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
        ? `Approved with changes: ${fb}`
        : "Approved"
      : `Rejected${fb ? `: ${fb}` : " — revise and present again"}`;
    setBubbles((prev) => [...prev, { kind: "decision", text: note, allow }]);
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

  // A test-scenario file referenced in a report, opened in a modal.
  const [scenarioPath, setScenarioPath] = useState<string | null>(null);

  const [continuing, setContinuing] = useState(false);
  const [changeReq, setChangeReq] = useState("");
  const [changeFiles, setChangeFiles] = useState<File[]>([]);
  // Resume a terminal task in its existing session, then re-open the live stream.
  // With a message and/or files the agent applies the requested changes; with neither
  // (the quick "Continue" button) it picks up where it left off.
  async function continueRun(withChanges: boolean) {
    const message = withChanges ? changeReq.trim() : "";
    const files = withChanges ? changeFiles : [];
    if (withChanges && !message && files.length === 0) return;
    setContinuing(true);
    // FormData when there are files; the continue API accepts multipart and JSON.
    const fd = new FormData();
    if (message) fd.set("message", message);
    for (const f of files) fd.append("files", f);
    const res = await fetch(`/api/tasks/${taskId}/continue`, {
      method: "POST",
      body: fd,
    });
    setContinuing(false);
    if (!res.ok) return;
    if (withChanges) {
      setChangeReq("");
      setChangeFiles([]);
    }
    setStatus("running");
    setReconnectKey((k) => k + 1); // reopen SSE from the last event id
  }

  const [converting, setConverting] = useState(false);
  // Spin up a new `/swe:task` that works through the findings in a report.
  async function createFixTask(reportText: string) {
    setConverting(true);
    const requestText =
      "Address the findings from the following report and implement the fixes, " +
      "working through them by priority (highest severity first):\n\n" +
      reportText;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, agentId, command: "task", requestText }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.id) {
      router.push(`/tasks/${body.id}`);
    } else {
      setConverting(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <StatusBadge status={status} />
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
            <span
              className={`size-1.5 rounded-full ${
                connected
                  ? "bg-emerald-400"
                  : active
                    ? "animate-pulse bg-amber-400"
                    : "bg-neutral-600"
              }`}
            />
            {connected ? "live" : active ? "reconnecting…" : "ended"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowActivity((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            <ListTree className="size-3.5" />
            {showActivity
              ? "Hide activity"
              : `Show activity${hiddenCount ? ` (${hiddenCount})` : ""}`}
          </button>
          {active && (
            <button
              onClick={stop}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/20"
            >
              <Square className="size-3.5 fill-current" />
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
          {visible.map((b, i) =>
            b.kind === "gate" && isPendingGate(b) ? (
              <GateCard
                key={i}
                gate={b.gate}
                feedback={feedback}
                setFeedback={setFeedback}
                onRespond={respond}
              />
            ) : (
              <BubbleView
                key={i}
                bubble={b}
                onConvert={createFixTask}
                converting={converting}
                onFileClick={setScenarioPath}
              />
            ),
          )}
          {showActivity && live && (
            <div className="whitespace-pre-wrap text-sm text-neutral-300">
              {live}
              <span className="ml-0.5 animate-pulse">▍</span>
            </div>
          )}
        </div>
      </div>

      {!active && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-neutral-400">
              Task {STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}.
            </p>
            {(status === "failed" || status === "cancelled") && (
              <button
                onClick={() => continueRun(false)}
                disabled={continuing}
                className="inline-flex items-center gap-2 rounded-lg border border-sky-700 bg-sky-600/15 px-3.5 py-1.5 text-sm font-medium text-sky-200 hover:bg-sky-600/25 disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" />
                {continuing ? "Resuming…" : "Continue from where it left off"}
              </button>
            )}
          </div>

          {/* Ask the agent to keep going — request changes (with optional files) on the
              result; it resumes the same session and updates its earlier work. */}
          <div className="mt-3 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20">
            <textarea
              value={changeReq}
              onChange={(e) => setChangeReq(e.target.value)}
              placeholder="Request changes or a follow-up — the agent continues this same job and updates its work…"
              rows={2}
              onKeyDown={(e) => {
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === "Enter" &&
                  (changeReq.trim() || changeFiles.length)
                )
                  continueRun(true);
              }}
              className="w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-600"
            />
            <div className="border-t border-neutral-800 px-3 py-2">
              <AttachmentPicker files={changeFiles} setFiles={setChangeFiles} />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-3 py-2">
              <span className="text-xs text-neutral-600">
                Continues the same session — edits its prior work, doesn&apos;t restart.
              </span>
              <button
                onClick={() => continueRun(true)}
                disabled={continuing || (!changeReq.trim() && changeFiles.length === 0)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-700 bg-gradient-to-b from-sky-500 to-blue-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="size-3.5" />
                {continuing ? "Sending…" : "Send to agent"}
              </button>
            </div>
          </div>
        </div>
      )}

      {scenarioPath && (
        <FileModal
          projectId={projectId}
          path={scenarioPath}
          onClose={() => setScenarioPath(null)}
        />
      )}
    </div>
  );
}

/** Interactive proposal/report gate, rendered inline in the transcript. */
function GateCard({
  gate,
  feedback,
  setFeedback,
  onRespond,
}: {
  gate: Gate;
  feedback: string;
  setFeedback: (v: string) => void;
  onRespond: (allow: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-200">
        <span className="text-base">🚦</span>
        {gate.gate === "proposal"
          ? "Proposal — approve to start building"
          : "Change report — approve to commit"}
      </div>
      <div className="mb-3 max-h-72 overflow-auto rounded-lg bg-neutral-950/50 p-3">
        <Markdown>{gate.summary}</Markdown>
      </div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Optional feedback (sent with Approve-with-changes or Reject)"
        rows={2}
        className="mb-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-amber-500"
      />
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onRespond(true)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          {feedback.trim() ? "Approve with changes" : "Approve"}
        </button>
        <button
          onClick={() => onRespond(false)}
          className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-300 hover:bg-red-950/50"
        >
          Reject &amp; revise
        </button>
      </div>
    </div>
  );
}

function BubbleView({
  bubble,
  onConvert,
  converting,
  onFileClick,
}: {
  bubble: Bubble;
  onConvert?: (text: string) => void;
  converting?: boolean;
  onFileClick?: (path: string) => void;
}) {
  if (bubble.kind === "request")
    return (
      <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
        <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-sky-300">
          <MessageSquare className="size-3.5" /> Request
        </div>
        {bubble.text.trim() ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
            {bubble.text}
          </p>
        ) : (
          <p className="text-sm text-neutral-500">(no description)</p>
        )}
        {bubble.attachments.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {bubble.attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300"
              >
                {a.type.startsWith("image/") ? (
                  <ImageIcon className="size-3.5 shrink-0 text-sky-400" />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-violet-400" />
                )}
                <span className="truncate">{a.name}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  if (bubble.kind === "log")
    return (
      <p className="font-mono text-xs text-neutral-500">— {bubble.text}</p>
    );
  if (bubble.kind === "report")
    return (
      <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400">
            <FileText className="size-3.5" /> Report
          </span>
          {onConvert && reportHasFindings(bubble.text) && (
            <button
              onClick={() => onConvert(bubble.text)}
              disabled={converting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
              title="Create a new task that fixes the issues in this report"
            >
              <Wrench className="size-3.5" />
              {converting ? "Creating…" : "Create fix task"}
            </button>
          )}
        </div>
        <Markdown onFileClick={onFileClick}>{bubble.text}</Markdown>
      </div>
    );
  if (bubble.kind === "decision")
    return (
      <div
        className={`ml-8 inline-flex max-w-[calc(100%-2rem)] items-start gap-1.5 rounded-lg border px-3 py-2 text-sm ${
          bubble.allow
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            : "border-red-500/30 bg-red-500/10 text-red-200"
        }`}
      >
        {bubble.allow ? (
          <Check className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <X className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span className="min-w-0 break-words">{bubble.text}</span>
      </div>
    );
  if (bubble.kind === "gate")
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-amber-300">
          <span>🚦</span>
          {bubble.gate.gate === "proposal" ? "Proposal" : "Change report"}
        </div>
        <div className="max-h-72 overflow-auto">
          <Markdown>{bubble.gate.summary}</Markdown>
        </div>
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
