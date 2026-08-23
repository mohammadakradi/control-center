"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  FolderTree,
  GitBranch,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Chip, EmptyState } from "@/components/ui-cards";
import { CardSection } from "@/components/ui-cards";
import { featureRowActions, FILE_OWNED_FEATURE_NOTE } from "@/lib/ui";
import type { FeatureStatus } from "@/lib/db/schema";

/** Mirrors `MAX_FEATURE_NAME_LENGTH` in `lib/features.ts`. The server still enforces it; this
 *  only stops someone typing past the limit and finding out from a 400. */
const MAX_NAME_LENGTH = 200;

export type ManagedFeature = {
  id: string;
  name: string;
  branch: string;
  status: FeatureStatus;
  sourceDir: string | null;
};

const STATUS_LABEL: Record<FeatureStatus, string> = {
  active: "Active",
  done: "Done",
  cancelled: "Cancelled",
};

/**
 * Create, rename, close out and delete a project's feature groups.
 *
 * Features were readable but unmanageable: the backlog sync derived them, a picker assigned work
 * to them, and every list rendered them as headings — but there was no way to add one, fix a
 * name, or get rid of one that had served its purpose. This card is that missing half.
 *
 * Three things it has to be careful about, all of which the server also enforces:
 *
 * - **A pm-derived feature is not editable here.** Its name comes from
 *   `.pm/tasks/<request>/index.md` and the row itself is re-derived on the next backlog load, so
 *   both a rename and a delete would appear to work and then undo themselves. The row says so
 *   rather than silently dropping the buttons (`featureRowActions`).
 * - **Delete is confirmed, and the confirmation is specific.** It ungroups rather than destroys —
 *   but "delete" on a thing that spans several tasks reads as "delete the work", so the dialog
 *   names exactly what survives: the backlog items, the task history, and the git branch.
 * - **A refusal is shown on the row that caused it.** The other delete guard — a run still in
 *   flight against the feature's branch — is a server-side 409 that depends on task rows this
 *   page can't see, so the error has to land where the click was.
 */
export function FeatureManager({
  projectId,
  projectName,
  features,
  itemCounts,
  className = "",
}: {
  projectId: string;
  projectName: string;
  features: ManagedFeature[];
  /** Backlog items per feature id. Items only, never tasks — see `backlogCountsByFeature`. */
  itemCounts: Record<string, number>;
  className?: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  /** Which row is being renamed, and to what. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<ManagedFeature | null>(null);
  /**
   * The row an action is in flight on. One write at a time across the whole list: it is the
   * spinner on its own row *and* the disabled state on every other (see `locked` below).
   */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAdd, setBusyAdd] = useState(false);
  /** Errors are per-row: a 409 about one feature must not appear against another. */
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  /** One place for the two write shapes, so the error handling can't drift between them. */
  async function send(
    featureId: string | null,
    init: RequestInit,
  ): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
    // Encoded even though both ids are server-minted (`f_`/`proj_` + hex): they are
    // interpolated into a path, so a value that ever grew a `/` or `..` would traverse it.
    // Defence in depth, not a live hole.
    const base = `/api/projects/${encodeURIComponent(projectId)}/features`;
    const url = featureId ? `${base}/${encodeURIComponent(featureId)}` : base;
    try {
      const res = await fetch(url, {
        headers: { "content-type": "application/json" },
        ...init,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (body as { error?: string }).error ?? `The request failed (${res.status})`;
        return { ok: false, message };
      }
      return { ok: true, body };
    } catch {
      // A rejected fetch left the old version of this spinning forever with nothing said.
      return { ok: false, message: "Couldn't reach the server." };
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busyAdd) return;
    setBusyAdd(true);
    setAddError(null);
    const res = await send(null, {
      method: "POST",
      body: JSON.stringify({ name: newName }),
    });
    setBusyAdd(false);
    if (!res.ok) {
      setAddError(res.message);
      return;
    }
    // Only cleared once the row exists — a failed submit must not lose what was typed.
    setNewName("");
    setAdding(false);
    router.refresh();
  }

  async function patch(feature: ManagedFeature, body: Record<string, unknown>) {
    if (busyId) return;
    setBusyId(feature.id);
    setRowError(null);
    const res = await send(feature.id, { method: "PATCH", body: JSON.stringify(body) });
    setBusyId(null);
    if (!res.ok) {
      setRowError({ id: feature.id, message: res.message });
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function remove(feature: ManagedFeature) {
    if (busyId) return;
    setBusyId(feature.id);
    setRowError(null);
    const res = await send(feature.id, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      // Close the dialog so the refusal is readable on the row it belongs to — a 409 behind a
      // modal that stays open reads as the dialog being broken.
      setConfirming(null);
      setRowError({ id: feature.id, message: res.message });
      return;
    }
    setConfirming(null);
    router.refresh();
  }

  return (
    <CardSection
      title="Features"
      className={className}
      right={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setAdding(true);
            setAddError(null);
          }}
          icon={<Plus className="size-3.5" aria-hidden="true" />}
        >
          Add feature
        </Button>
      }
    >
      {features.length === 0 ? (
        <EmptyState
          icon={<FolderTree className="size-6" />}
          title="No features yet"
          hint="A feature groups several tasks and backlog items onto one branch. Planned work gets one automatically; add one here to group work by hand."
        />
      ) : (
        <ul className="divide-y divide-line">
          {features.map((f) => {
            const actions = featureRowActions(f);
            const items = itemCounts[f.id] ?? 0;
            const busy = busyId === f.id;
            // `busyId` is a single lock for the whole list, and `patch`/`remove` refuse while it
            // is held. So every row's controls have to be disabled while *any* row is working —
            // disabling only the busy row left the others clickable and their clicks were
            // swallowed with no spinner, no error and no change: indistinguishable from a broken
            // button (correctness review). One in-flight write at a time is the right model here;
            // what was wrong was not saying so in the UI.
            const locked = busyId !== null && !busy;
            const isEditing = editing?.id === f.id;
            return (
              <li key={f.id} className="py-3 first:pt-0 last:pb-0">
                {isEditing ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void patch(f, { name: editing.name });
                    }}
                  >
                    <label className="sr-only" htmlFor={`feature-name-${f.id}`}>
                      {`Rename ${f.name}`}
                    </label>
                    <Input
                      id={`feature-name-${f.id}`}
                      value={editing.name}
                      onChange={(e) => setEditing({ id: f.id, name: e.target.value })}
                      maxLength={MAX_NAME_LENGTH}
                      required
                      autoFocus
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      loading={busy}
                      disabled={locked || editing.name.trim() === ""}
                      icon={<Check className="size-3.5" aria-hidden="true" />}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || locked}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg-strong">{f.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {/* `break-all` and no truncation: this is the string you type into
                            `git checkout`, so a hidden suffix is useless — same rule as
                            FeatureGroup's chip. */}
                        <span className="inline-flex min-w-0 items-center gap-1 font-mono text-fg-faint">
                          <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                          <span className="break-all">{f.branch}</span>
                        </span>
                        {f.status !== "active" && (
                          <Chip>{STATUS_LABEL[f.status]}</Chip>
                        )}
                        {items > 0 && (
                          <span className="text-fg-faint">
                            {`${items} backlog item${items === 1 ? "" : "s"}`}
                          </span>
                        )}
                        {/* The folder is the row-specific fact — where to go to change this
                            one. Why it can't be changed here is said once, under the list. */}
                        {actions.sourceDir && (
                          <span className="inline-flex min-w-0 items-center gap-1 text-fg-faint">
                            <FolderTree className="size-3 shrink-0" aria-hidden="true" />
                            <span className="font-mono break-all">{actions.sourceDir}/</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {actions.canRename && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || locked}
                          onClick={() => {
                            setRowError(null);
                            setEditing({ id: f.id, name: f.name });
                          }}
                          // `title` for the mouse, `sr-only` for the accessible name. Not a
                          // tooltip *instead* of a label — a title alone is unreachable by
                          // keyboard and screen reader.
                          title={`Rename ${f.name}`}
                          icon={<Pencil className="size-3.5" aria-hidden="true" />}
                        >
                          <span className="sr-only">{`Rename ${f.name}`}</span>
                        </Button>
                      )}
                      {actions.canClose && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busy}
                          disabled={locked}
                          onClick={() => void patch(f, { status: "done" })}
                        >
                          <span aria-hidden="true">Close out</span>
                          <span className="sr-only">{`Close out ${f.name}`}</span>
                        </Button>
                      )}
                      {actions.canReopen && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busy}
                          disabled={locked}
                          onClick={() => void patch(f, { status: "active" })}
                          icon={<RotateCcw className="size-3.5" aria-hidden="true" />}
                        >
                          <span aria-hidden="true">Reopen</span>
                          <span className="sr-only">{`Reopen ${f.name}`}</span>
                        </Button>
                      )}
                      {actions.canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || locked}
                          onClick={() => {
                            setRowError(null);
                            setConfirming(f);
                          }}
                          title={`Delete ${f.name}`}
                          icon={<Trash2 className="size-3.5" aria-hidden="true" />}
                        >
                          <span className="sr-only">{`Delete ${f.name}`}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {rowError?.id === f.id && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {rowError.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Only when a derived row is actually on screen: on a project nobody has planned with
          /pm, this paragraph would explain a restriction the user can't see the effect of. */}
      {features.some((f) => f.sourceDir) && (
        <p className="mt-3 border-t border-line pt-3 text-xs text-fg-faint">
          {FILE_OWNED_FEATURE_NOTE}
        </p>
      )}

      {adding && (
        <Modal
          label={`Add a feature to ${projectName}`}
          header={
            <span className="truncate text-sm font-medium text-fg-strong">
              Add a feature — {projectName}
            </span>
          }
          onClose={() => {
            if (busyAdd) return;
            setAdding(false);
            setAddError(null);
          }}
          className="max-w-lg"
        >
          <form onSubmit={add} className="flex min-h-0 flex-col">
            <div className="space-y-4 p-4">
              <div>
                <label
                  htmlFor="new-feature-name"
                  className="mb-1.5 block text-xs font-medium text-fg-muted"
                >
                  Name
                </label>
                <Input
                  id="new-feature-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={MAX_NAME_LENGTH}
                  required
                  autoFocus
                  placeholder="Invoice approval flow"
                />
                <p className="mt-1.5 text-xs text-fg-faint">
                  A branch name is reserved from this — <code>feature/…</code> — and never
                  changes afterwards, even if you rename the feature. Tasks you run under it get
                  their work merged into that branch.
                </p>
              </div>
              {addError && (
                <p role="alert" className="text-xs text-danger">
                  {addError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={busyAdd}
                onClick={() => {
                  setAdding(false);
                  setAddError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={busyAdd}
                disabled={newName.trim() === ""}
              >
                {busyAdd ? "Adding…" : "Add feature"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {confirming && (
        <Modal
          label={`Delete the feature ${confirming.name}`}
          header={
            <span className="inline-flex items-center gap-2 text-sm font-medium text-fg-strong">
              <TriangleAlert className="size-4 text-warn" aria-hidden="true" />
              Delete this feature?
            </span>
          }
          onClose={() => {
            if (busyId) return;
            setConfirming(null);
          }}
          className="max-w-lg"
        >
          <div className="space-y-3 p-4 text-sm">
            <p className="text-fg-muted">
              <span className="font-medium text-fg-strong">{confirming.name}</span> stops
              existing as a grouping. Nothing it grouped is deleted:
            </p>
            {/* Spelled out because "delete" on something spanning several tasks reads as
                "delete the work". Each line is a thing a user would otherwise fear losing. */}
            <ul className="space-y-1.5 text-xs text-fg-muted">
              <li>
                · Its{" "}
                {(itemCounts[confirming.id] ?? 0) > 0
                  ? `${itemCounts[confirming.id]} backlog item${itemCounts[confirming.id] === 1 ? "" : "s"} stay${itemCounts[confirming.id] === 1 ? "s" : ""}`
                  : "backlog items stay"}
                , just no longer grouped.
              </li>
              <li>· Task history stays, with its transcripts, just no longer grouped.</li>
              <li>
                · The branch{" "}
                <span className="font-mono break-all text-fg-subtle">
                  {confirming.branch}
                </span>{" "}
                and every commit on it are untouched — nothing here runs git.
              </li>
            </ul>
            <p className="text-xs text-fg-faint">
              If you only want it out of the way, close it out instead — that keeps the grouping
              and collapses it as history.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={busyId === confirming.id}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busyId === confirming.id}
              // Same reason as the rows: `remove` refuses while another row's write is in
              // flight, so the button must not look pressable while it would be a no-op.
              disabled={busyId !== null && busyId !== confirming.id}
              onClick={() => void remove(confirming)}
              icon={<Trash2 className="size-3.5" aria-hidden="true" />}
            >
              Delete feature
            </Button>
          </div>
        </Modal>
      )}
    </CardSection>
  );
}
