"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Send, X } from "lucide-react";
import { Markdown } from "@/components/Markdown";

/** A pm task spec lives at `.pm/tasks/<timestamp>/<task>.md`. */
const isPmTaskPath = (p: string) => /(^|\/)\.pm\/tasks\//.test(p);

/** Pull a few fields out of a task file's YAML-ish frontmatter (best-effort). */
function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Which agent a task should go to: explicit `assignee`, else derive from `stack`. */
function targetNamespace(fm: Record<string, string>): "fe" | "swe" {
  const a = (fm.assignee || "").toLowerCase();
  if (a === "fe" || a === "swe") return a;
  return (fm.stack || "").toLowerCase() === "frontend" ? "fe" : "swe";
}

type Agent = { id: string; namespace: string };

/** Loads an in-repo file and shows it in a modal (markdown rendered, else plain text).
 *  For pm task specs, adds Copy + "Create task" (dispatches a job to the swe/fe agent). */
export function FileModal({
  projectId,
  member,
  path,
  onClose,
}: {
  projectId: string;
  member?: string;
  path: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ path });
    if (member) params.set("member", member);
    fetch(`/api/projects/${projectId}/file?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { content?: string; error?: string }) => {
        if (typeof d.content === "string") setContent(d.content);
        else setErr(d.error ?? "Could not load file");
      })
      .catch((e) => setErr((e as Error).message));
  }, [projectId, member, path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isMarkdown = path.endsWith(".md") || path.endsWith(".markdown");
  const isTask = isPmTaskPath(path);

  async function copy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  // Hand the task off to the right agent: frontend-only → fe, otherwise → swe.
  async function createTask() {
    if (!content) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const fm = parseFrontmatter(content);
      const want = targetNamespace(fm);
      const agents = (await fetch("/api/agents").then((r) => r.json())) as Agent[];
      const agent =
        agents.find((a) => a.namespace === want) ??
        agents.find((a) => a.namespace === "swe"); // fall back to swe if fe isn't installed
      if (!agent) {
        setCreateErr(`No ${want} (or swe) agent is available to take this task.`);
        setCreating(false);
        return;
      }
      const requestText = `Implement this task spec (source: ${path}):\n\n${content}`;
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          agentId: agent.id,
          command: "task",
          requestText,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.id) {
        onClose();
        router.push(`/tasks/${body.id}`);
      } else {
        setCreateErr(body.error ?? "Could not create the task.");
        setCreating(false);
      }
    } catch (e) {
      setCreateErr((e as Error).message);
      setCreating(false);
    }
  }

  const assignee = content && isTask ? targetNamespace(parseFrontmatter(content)) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <span className="truncate font-mono text-sm text-neutral-200">{path}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={copy}
              disabled={content === null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-400" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-3.5" /> Copy
                </>
              )}
            </button>
            {isTask && (
              <button
                onClick={createTask}
                disabled={content === null || creating}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
                title={assignee ? `Dispatch this task to the ${assignee} agent` : "Create a task"}
              >
                {creating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {creating
                  ? "Creating…"
                  : `Create task${assignee ? ` → ${assignee}` : ""}`}
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        {createErr && (
          <p className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">
            {createErr}
          </p>
        )}
        <div className="scroll-thin overflow-auto p-4">
          {err ? (
            <p className="p-3 text-sm text-red-400">{err}</p>
          ) : content === null ? (
            <p className="inline-flex items-center gap-2 p-3 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" /> Loading file…
            </p>
          ) : content.trim() === "" ? (
            <p className="p-3 text-sm text-neutral-500">This file is empty.</p>
          ) : isMarkdown ? (
            <Markdown>{content}</Markdown>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-300">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
