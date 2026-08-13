"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, fieldClasses } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";

/** Mirror `MAX_TITLE_LENGTH` / `MAX_DESCRIPTION_LENGTH` in `lib/backlog.ts`, which can't be
 *  imported here (that module reaches for `node:fs`). The server still enforces both; these
 *  only stop someone typing past the limit and finding out from a 400. */
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 20_000;

const ASSIGNEES = [
  { value: "", label: "Decide at dispatch", description: "Route by the item's own text" },
  { value: "fe", label: "/fe", description: "Frontend — UI, components, design" },
  { value: "swe", label: "/swe", description: "Software engineer — everything else" },
  // pm doesn't build: it investigates a problem and plans it into tasks, which then arrive in
  // this same backlog through the `.pm/tasks/` sync. Runs as `/pm:plan`, not `/pm:task`.
  { value: "pm", label: "/pm", description: "Project manager — investigate & break it down" },
];

/**
 * Add a backlog item by hand.
 *
 * A dialog rather than a form parked above the list: adding is occasional, the list is the
 * page, and `Modal` already brings the focus trap and Escape handling a form in an overlay
 * needs. Only ever creates `source: "manual"` items — the API decides that, not the client.
 */
export function AddBacklogItem({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Escape, the backdrop and the header ✕ all land here, so this is the one place that has to
   * refuse while a submit is in flight. Otherwise the request outlives the dialog: reopen to
   * start a different item and the earlier response arrives to clear the fields you have just
   * typed into, or to show its error as if it belonged to this attempt. The window is one
   * POST, and the submit button says "Adding…" throughout.
   */
  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/backlog`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description, assignee }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? `Could not add the item (${res.status})`);
      // Only clear the fields once the row exists — a failed submit must not lose what was
      // typed into it.
      setTitle("");
      setDescription("");
      setAssignee("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the item");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onClick={() => setOpen(true)}
        icon={<Plus className="size-3.5" aria-hidden="true" />}
      >
        Add item
      </Button>

      {open && (
        <Modal
          label={`Add a backlog item to ${projectName}`}
          header={
            <span className="truncate text-sm font-medium text-fg-strong">
              Add a backlog item — {projectName}
            </span>
          }
          onClose={close}
          className="max-w-xl"
        >
          <form onSubmit={submit} className="flex min-h-0 flex-col">
            <div className="scroll-thin space-y-4 overflow-auto p-4">
              <div>
                <label
                  htmlFor="backlog-title"
                  className="mb-1.5 block text-xs font-medium text-fg-muted"
                >
                  Title
                </label>
                <Input
                  id="backlog-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={MAX_TITLE_LENGTH}
                  required
                  placeholder="What needs doing?"
                />
              </div>

              <div>
                <label
                  htmlFor="backlog-description"
                  className="mb-1.5 block text-xs font-medium text-fg-muted"
                >
                  Description{" "}
                  <span className="font-normal text-fg-faint">
                    — handed to the agent as the request when this item runs
                  </span>
                </label>
                <textarea
                  id="backlog-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={MAX_DESCRIPTION_LENGTH}
                  rows={6}
                  placeholder="Context, acceptance criteria, links…"
                  className={fieldClasses("md", "default", "min-h-32 resize-y leading-relaxed")}
                />
              </div>

              <div>
                {/* The control's accessible name is `ariaLabel="Agent"`, matching this
                    visible text — `Select` renders a button, not a labellable element. */}
                <span className="mb-1.5 block text-xs font-medium text-fg-muted">
                  Agent
                </span>
                {/* Last control before the sticky footer, so the popover opens upward —
                    same reason `NewTaskForm`'s model select does. */}
                <Select
                  value={assignee}
                  onChange={setAssignee}
                  options={ASSIGNEES}
                  ariaLabel="Agent"
                  placement="up"
                  className="w-full"
                />
              </div>

              {error && (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={busy}
                disabled={title.trim() === ""}
              >
                {busy ? "Adding…" : "Add item"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
