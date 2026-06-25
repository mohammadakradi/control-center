"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="font-mono text-xs leading-relaxed">
      {diff.split("\n").map((line, i) => {
        let cls = "text-neutral-400";
        if (line.startsWith("+") && !line.startsWith("+++"))
          cls = "bg-emerald-500/10 text-emerald-300";
        else if (line.startsWith("-") && !line.startsWith("---"))
          cls = "bg-red-500/10 text-red-300";
        else if (line.startsWith("@@")) cls = "text-sky-400";
        else if (
          line.startsWith("diff ") ||
          line.startsWith("index ") ||
          line.startsWith("+++") ||
          line.startsWith("---") ||
          line.startsWith("new file") ||
          line.startsWith("deleted file")
        )
          cls = "text-neutral-600";
        return (
          <div key={i} className={`whitespace-pre-wrap px-2 ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function DiffModal({
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
  const [diff, setDiff] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ path });
    if (member) params.set("member", member);
    fetch(`/api/projects/${projectId}/diff?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { diff?: string; error?: string }) => {
        if (typeof d.diff === "string") setDiff(d.diff);
        else setErr(d.error ?? "Could not load diff");
      })
      .catch((e) => setErr((e as Error).message));
  }, [projectId, member, path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <span className="truncate font-mono text-sm text-neutral-200">
            {path}
          </span>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="scroll-thin overflow-auto p-3">
          {err ? (
            <p className="p-3 text-sm text-red-400">{err}</p>
          ) : diff === null ? (
            <p className="inline-flex items-center gap-2 p-3 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" /> Loading diff…
            </p>
          ) : diff.trim() === "" ? (
            <p className="p-3 text-sm text-neutral-500">
              No diff available for this file.
            </p>
          ) : (
            <DiffView diff={diff} />
          )}
        </div>
      </div>
    </div>
  );
}
