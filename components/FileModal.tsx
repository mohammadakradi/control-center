"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

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

  // Escape-to-close, the focus trap, and scroll locking all live in `Modal`.

  const isMarkdown = path.endsWith(".md") || path.endsWith(".markdown");
  // Only individual task files are hand-offable — not the request's index/summary.
  const isTask = isPmTaskPath(path) && !/\/index\.md$/i.test(path);

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
    <Modal
      label={path}
      header={<span className="truncate font-mono text-sm text-fg">{path}</span>}
      onClose={onClose}
      className="max-w-3xl"
      actions={
        <>
          <Button
            size="sm"
            onClick={copy}
            disabled={content === null}
            icon={
              copied ? (
                <Check className="size-3.5 text-ok" />
              ) : (
                <Copy className="size-3.5" />
              )
            }
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          {isTask && (
            <Button
              size="sm"
              variant="accent"
              onClick={createTask}
              disabled={content === null}
              loading={creating}
              icon={<Send className="size-3.5" />}
              title={
                assignee
                  ? `Dispatch this task to the ${assignee} agent`
                  : "Create a task"
              }
            >
              {creating
                ? "Creating…"
                : `Create task${assignee ? ` → ${assignee}` : ""}`}
            </Button>
          )}
        </>
      }
    >
      {createErr && (
        <p
          role="alert"
          className="border-b border-danger-line bg-danger-soft px-4 py-2 text-xs text-danger"
        >
          {createErr}
        </p>
      )}
      <div className="scroll-thin overflow-auto p-4">
        {err ? (
          <p role="alert" className="p-3 text-sm text-danger">
            {err}
          </p>
        ) : content === null ? (
          <p className="inline-flex items-center gap-2 p-3 text-sm text-fg-faint">
            <Loader2 className="size-4 animate-spin" /> Loading file…
          </p>
        ) : content.trim() === "" ? (
          <p className="p-3 text-sm text-fg-faint">This file is empty.</p>
        ) : isMarkdown ? (
          <Markdown>{content}</Markdown>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg-muted">
            {content}
          </pre>
        )}
      </div>
    </Modal>
  );
}
