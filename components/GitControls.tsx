"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  GitBranch,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import type { BranchInfo } from "@/lib/git";
import { Select } from "@/components/ui/select";

export function GitControls({
  projectId,
  info,
  member,
}: {
  projectId: string;
  info: BranchInfo;
  member?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function call(action: string, branch?: string) {
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/git`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, branch, member }),
      });
      const data = (await res.json()) as { output?: string; error?: string };
      setMsg({
        ok: res.ok,
        text: data.output ?? data.error ?? (res.ok ? "Done." : "Failed."),
      });
      if (res.ok) router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;
  const syncBtn =
    "inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-fg hover:bg-surface-3 disabled:opacity-50";

  return (
    <div className="space-y-3">
      {/* Branch row */}
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch className="size-4 shrink-0 text-fg-faint" />
        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (name) {
                call("create", name);
                setCreating(false);
                setNewName("");
              }
            }}
            className="flex flex-1 items-center gap-2"
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="new-branch-name"
              aria-label="New branch name"
              className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 font-mono text-sm text-fg outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <button
              type="submit"
              disabled={disabled}
              className={syncBtn}
              aria-label="Create branch"
            >
              <Check className="size-4" />
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              className="p-1.5 text-fg-faint hover:text-fg-muted"
              aria-label="Cancel"
            >
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <Select
              mono
              searchable
              ariaLabel="Switch branch"
              className="min-w-0 flex-1"
              value={info.current ?? ""}
              disabled={disabled}
              onChange={(branch) => call("checkout", branch)}
              options={[
                ...(info.current && !info.branches.includes(info.current)
                  ? [{ value: info.current, label: info.current }]
                  : []),
                ...info.branches.map((b) => ({ value: b, label: b })),
              ]}
            />
            <button
              onClick={() => setCreating(true)}
              disabled={disabled}
              className={syncBtn}
            >
              <Plus className="size-4" />
              New branch
            </button>
          </>
        )}
      </div>

      {/* Remote sync row — on wide viewports Pull/Push stay anchored right and the
          tracking text truncates so the buttons keep a constant position; on cramped
          (mobile) widths the button group wraps to its own line instead of overflowing. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-line bg-sunken px-3.5 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-fg-subtle">
          {info.tracking ? (
            <>
              <span className="min-w-0 truncate">
                tracking{" "}
                <span className="font-mono text-fg-muted">{info.tracking}</span>
              </span>
              {info.ahead > 0 && (
                <span className="shrink-0 rounded-md border border-warn-line bg-warn-soft px-1.5 py-0.5 font-mono text-warn">
                  ↑{info.ahead}
                </span>
              )}
              {info.behind > 0 && (
                <span className="shrink-0 rounded-md border border-info-line bg-info-soft px-1.5 py-0.5 font-mono text-accent">
                  ↓{info.behind}
                </span>
              )}
              {info.ahead === 0 && info.behind === 0 && (
                <span className="shrink-0 text-ok">· up to date</span>
              )}
            </>
          ) : info.hasRemote ? (
            "no upstream set — Push will set it"
          ) : (
            "no remote configured"
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => call("pull")}
            disabled={disabled || !info.hasRemote}
            className={syncBtn}
            title={info.hasRemote ? "git pull --ff-only" : "No remote configured"}
          >
            {busy === "pull" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowDownToLine className="size-4" />
            )}
            Pull
          </button>
          <button
            onClick={() => call("push")}
            disabled={disabled || !info.hasRemote}
            className={syncBtn}
            title={info.hasRemote ? "git push origin HEAD" : "No remote configured"}
          >
            {busy === "push" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUpFromLine className="size-4" />
            )}
            Push
          </button>
        </div>
      </div>

      {msg && (
        <pre
          // Pull/push/create results are announced — they're the only feedback
          // these actions give.
          role={msg.ok ? "status" : "alert"}
          aria-live={msg.ok ? "polite" : "assertive"}
          className={`scroll-thin max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg px-3 py-2 font-mono text-xs ${
            msg.ok
              ? "bg-sunken text-fg-subtle"
              : "bg-danger-soft text-danger"
          }`}
        >
          {msg.text}
        </pre>
      )}
    </div>
  );
}
