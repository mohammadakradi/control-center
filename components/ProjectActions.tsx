"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Trash2 } from "lucide-react";

export function ProjectActions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function rescan() {
    setBusy("rescan");
    await fetch(`/api/projects/${projectId}/rescan`, { method: "POST" });
    setBusy(null);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Remove this project from the platform? (Files are untouched.)"))
      return;
    setBusy("delete");
    await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    router.push("/projects");
  }

  return (
    <div className="flex shrink-0 gap-2">
      <button
        onClick={rescan}
        disabled={busy !== null}
        className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-white/[0.02] px-3.5 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
      >
        <RotateCw className={`size-4 ${busy === "rescan" ? "animate-spin" : ""}`} />
        {busy === "rescan" ? "Rescanning…" : "Rescan"}
      </button>
      <button
        onClick={remove}
        disabled={busy !== null}
        className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-sm text-red-300 hover:bg-red-500/20 disabled:opacity-50"
      >
        <Trash2 className="size-4" />
        {busy === "delete" ? "Removing…" : "Remove"}
      </button>
    </div>
  );
}
