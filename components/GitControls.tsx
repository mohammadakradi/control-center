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
    "inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";

  return (
    <div className="space-y-3">
      {/* Branch row */}
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch className="size-4 shrink-0 text-neutral-500" />
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
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm outline-none focus:border-sky-500"
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
              className="p-1.5 text-neutral-500 hover:text-neutral-300"
              aria-label="Cancel"
            >
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <div className="relative min-w-0 flex-1">
              <select
                value={info.current ?? ""}
                disabled={disabled}
                onChange={(e) => call("checkout", e.target.value)}
                className="w-full truncate rounded-lg border border-neutral-700 bg-neutral-900 py-2 pr-8 pl-3 text-sm text-neutral-200 outline-none focus:border-sky-500 disabled:opacity-50"
              >
                {info.current && !info.branches.includes(info.current) && (
                  <option value={info.current}>{info.current}</option>
                )}
                {info.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
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

      {/* Remote sync row — never wraps; Pull/Push stay anchored right and the
          tracking text truncates so the buttons keep a constant position. */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-neutral-400">
          {info.tracking ? (
            <>
              <span className="min-w-0 truncate">
                tracking{" "}
                <span className="font-mono text-neutral-300">{info.tracking}</span>
              </span>
              {info.ahead > 0 && (
                <span className="shrink-0 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-amber-300">
                  ↑{info.ahead}
                </span>
              )}
              {info.behind > 0 && (
                <span className="shrink-0 rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 font-mono text-sky-300">
                  ↓{info.behind}
                </span>
              )}
              {info.ahead === 0 && info.behind === 0 && (
                <span className="shrink-0 text-emerald-400">· up to date</span>
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
          className={`max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg px-3 py-2 font-mono text-xs ${
            msg.ok
              ? "bg-neutral-950/60 text-neutral-400"
              : "bg-red-950/40 text-red-300"
          }`}
        >
          {msg.text}
        </pre>
      )}
    </div>
  );
}
