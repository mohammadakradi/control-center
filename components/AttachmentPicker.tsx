"use client";

import { useRef, useState } from "react";
import { FileText, ImageIcon, Paperclip, X } from "lucide-react";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB each
export const ACCEPT =
  "image/*,.pdf,.md,.markdown,.txt,.csv,.json,.log,.docx,.xlsx,.html,.yml,.yaml";

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Merge incoming files into an existing set: drop oversized + duplicates, cap at MAX_FILES. */
export function mergeFiles(
  existing: File[],
  incoming: FileList | File[] | null,
): { files: File[]; error?: string } {
  if (!incoming) return { files: existing };
  const next = [...existing];
  let error: string | undefined;
  for (const f of Array.from(incoming)) {
    if (f.size > MAX_FILE_BYTES) {
      error = `"${f.name}" is larger than 25 MB and was skipped.`;
      continue;
    }
    if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
  }
  return { files: next.slice(0, MAX_FILES), error };
}

/** Attach-files bar: a button + selected-file chips. Controlled via `files`/`setFiles`.
 *  Shared by the New-task form and the task-detail "request changes" box. */
export function AttachmentPicker({
  files,
  setFiles,
  hint = "or drop documents & photos here",
}: {
  files: File[];
  setFiles: (f: File[]) => void;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function add(incoming: FileList | File[] | null) {
    const { files: merged, error: err } = mergeFiles(files, incoming);
    setFiles(merged);
    setError(err ?? null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
        title="Attach documents or photos"
      >
        <Paperclip className="size-3.5" />
        Attach files
      </button>
      {files.length === 0 ? (
        <span className="text-xs text-neutral-600">{hint}</span>
      ) : (
        files.map((f, i) => {
          const isImg = f.type.startsWith("image/");
          return (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300"
            >
              {isImg ? (
                <ImageIcon className="size-3.5 shrink-0 text-sky-400" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-violet-400" />
              )}
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-neutral-600">{fmtSize(f.size)}</span>
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                aria-label={`Remove ${f.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })
      )}
      {error && <span className="text-xs text-amber-400">{error}</span>}
    </div>
  );
}
