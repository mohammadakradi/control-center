"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Markdown } from "@/components/Markdown";

/** Loads an in-repo file and shows it in a modal (markdown rendered, else plain text). */
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
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
