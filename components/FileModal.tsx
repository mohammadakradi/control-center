"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { ErrorAlert, type ErrorAction } from "@/components/ui/error-alert";
import { Modal } from "@/components/ui/modal";
import {
  isPmTaskSpec,
  parseFrontmatter,
  specSourcePath,
  targetNamespace,
} from "@/lib/pm-spec";
import { dispatchErrorAction } from "@/lib/ui";

type Agent = { id: string; namespace: string };

/** Just enough of a backlog item to find the one that owns this file and run it. */
type BacklogEntry = { id: string; sourcePath: string | null };

/**
 * What the backlog knows about this file.
 *
 * `failed` is deliberately not folded into `none`. They demand opposite actions: "there is no
 * item" means dispatch directly, while "I could not find out" means we don't know whether this
 * spec is already running — and the direct dispatch has no duplicate check, so treating the two
 * alike turns one transient error into two concurrent agent sessions on the same spec, billed
 * to the user twice and editing the same files at once.
 */
type BacklogLookup =
  | { state: "none" }
  | { state: "item"; id: string }
  | { state: "failed" };

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
  /** Set when dispatch was refused for a reason the user can act on, so the message can carry
   *  a link instead of being a dead end. */
  const [createErrAction, setCreateErrAction] = useState<ErrorAction | null>(null);

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
  const isTask = isPmTaskSpec(path);

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

  /**
   * Find the backlog item this file was imported as.
   *
   * The GET is also what syncs `.pm/tasks/`, so a spec that exists on disk is guaranteed to
   * have a row — and a current one — by the time the list comes back. That is what makes a
   * clean 200 with no match trustworthy as `none`: it means the backlog genuinely can't hold
   * this file, not that it hasn't noticed it yet. A workspace member's spec is `none` without
   * asking, since only the project root's `.pm/tasks/` is ever scanned.
   */
  async function resolveBacklogItem(): Promise<BacklogLookup> {
    const sourcePath = member ? null : specSourcePath(path);
    if (!sourcePath) return { state: "none" };
    try {
      const res = await fetch(`/api/projects/${projectId}/backlog`);
      if (!res.ok) {
        console.error(`Backlog lookup failed for ${sourcePath}: HTTP ${res.status}`);
        return { state: "failed" };
      }
      const data = (await res.json()) as { items?: BacklogEntry[] };
      const found = data.items?.find((i) => i.sourcePath === sourcePath);
      return found ? { state: "item", id: found.id } : { state: "none" };
    } catch (e) {
      console.error(`Backlog lookup failed for ${sourcePath}:`, e);
      return { state: "failed" };
    }
  }

  /**
   * Run the item — the same dispatch the backlog page's Run button makes, so the item is
   * linked to the task and follows it (in progress while it runs, done when it finishes).
   *
   * Everything the direct path below does by hand, this route already does: picking the agent
   * from the item's assignee, falling back to swe, `/pm:plan` for a pm item, passing the title
   * through so no model is paid to rename it, and refusing a second run of work already going.
   * Returns the new task's id, or null having set the error.
   */
  async function runBacklogItem(itemId: string): Promise<string | null> {
    const res = await fetch(`/api/projects/${projectId}/backlog/${itemId}/run`, {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.task?.id) return body.task.id as string;
    setCreateErr(body.error ?? `Could not start the task (${res.status}).`);
    setCreateErrAction(dispatchErrorAction(body));
    return null;
  }

  /**
   * Dispatch with no backlog item behind it — a spec in a workspace member repo, or one the
   * scan refused (a symlink, an oversized file, a project past the scan's caps). The agent is
   * resolved here because there's no row to read an assignee off: frontend-only → fe,
   * otherwise → swe. Returns the new task's id, or null having set the error.
   */
  async function dispatchDirect(spec: string): Promise<string | null> {
    const want = targetNamespace(parseFrontmatter(spec));
    const agents = (await fetch("/api/agents").then((r) => r.json())) as Agent[];
    const agent =
      agents.find((a) => a.namespace === want) ??
      agents.find((a) => a.namespace === "swe"); // fall back to swe if fe isn't installed
    if (!agent) {
      setCreateErr(`No ${want} (or swe) agent is available to take this task.`);
      return null;
    }
    // Kept byte-for-byte identical to `backlogRequestText`, so the same spec produces the
    // same run whichever of the two paths dispatched it.
    const requestText = `Implement this task spec (source: ${path}):\n\n${spec}`;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, agentId: agent.id, command: "task", requestText }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.id) return body.id as string;
    setCreateErr(body.error ?? "Could not create the task.");
    setCreateErrAction(dispatchErrorAction(body));
    return null;
  }

  // Hand the spec off, through its backlog item where there is one so the backlog learns the
  // work was started — dispatching straight past it left the item sitting at "todo" forever.
  async function createTask() {
    if (!content || creating) return; // the button is disabled too; this can't be raced
    setCreating(true);
    setCreateErr(null);
    setCreateErrAction(null);
    try {
      const lookup = await resolveBacklogItem();
      if (lookup.state === "failed") {
        // Refuse rather than fall back. Dispatching anyway would skip the run route's
        // already-running check on a spec that may well be running, and a duplicate session
        // costs the user real money and puts two agents in the same files. Retrying is one
        // click; undoing two live runs is not.
        setCreateErr(
          "Couldn't read this project's backlog, so nothing was started — running this now could start a second copy of work that's already going. Try again.",
        );
      } else {
        const taskId =
          lookup.state === "item"
            ? await runBacklogItem(lookup.id)
            : await dispatchDirect(content);
        if (taskId) {
          onClose();
          router.push(`/tasks/${taskId}`);
          return; // keep the spinner up through the navigation
        }
      }
    } catch (e) {
      setCreateErr((e as Error).message);
    }
    setCreating(false);
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
      <ErrorAlert
        message={createErr}
        action={createErrAction}
        className="border-b border-danger-line bg-danger-soft px-4 py-2 text-xs"
      />
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
