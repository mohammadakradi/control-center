"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="font-mono text-xs leading-relaxed">
      {diff.split("\n").map((line, i) => {
        let cls = "text-fg-subtle";
        if (line.startsWith("+") && !line.startsWith("+++"))
          cls = "bg-ok-soft text-ok";
        else if (line.startsWith("-") && !line.startsWith("---"))
          cls = "bg-danger-soft text-danger";
        else if (line.startsWith("@@")) cls = "text-accent";
        else if (
          line.startsWith("diff ") ||
          line.startsWith("index ") ||
          line.startsWith("+++") ||
          line.startsWith("---") ||
          line.startsWith("new file") ||
          line.startsWith("deleted file")
        )
          cls = "text-fg-ghost";
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

  return (
    <Modal
      label={`Diff for ${path}`}
      header={<span className="truncate font-mono text-sm text-fg">{path}</span>}
      onClose={onClose}
      className="max-w-4xl"
    >
      <div className="scroll-thin overflow-auto bg-sunken p-3">
        {err ? (
          <p role="alert" className="p-3 text-sm text-danger">
            {err}
          </p>
        ) : diff === null ? (
          <p className="inline-flex items-center gap-2 p-3 text-sm text-fg-faint">
            <Loader2 className="size-4 animate-spin" /> Loading diff…
          </p>
        ) : diff.trim() === "" ? (
          <p className="p-3 text-sm text-fg-faint">
            No diff available for this file.
          </p>
        ) : (
          <DiffView diff={diff} />
        )}
      </div>
    </Modal>
  );
}
