"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, X } from "lucide-react";

/** The project title, editable in place. Click the pencil to rename; the name is
 *  cosmetic (the on-disk path is the project's stable identity) and survives rescans. */
export function ProjectName({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setValue(name);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const next = value.trim();
    if (!next) {
      setError("Name can’t be empty");
      return;
    }
    if (next === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Couldn’t rename");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <h1 className="group flex items-center gap-2 text-2xl font-bold tracking-tight break-words sm:text-3xl">
        <span className="min-w-0 break-words">{name}</span>
        <button
          type="button"
          onClick={open}
          aria-label="Rename project"
          title="Rename project"
          className="shrink-0 rounded-md p-1.5 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-800 hover:text-neutral-200 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="size-4" />
        </button>
      </h1>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={value}
          maxLength={100}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Project name"
          className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-2xl font-bold tracking-tight text-neutral-100 outline-none focus:border-sky-500 sm:text-3xl"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-700 bg-linear-to-b from-sky-500 to-blue-600 px-3 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          <X className="size-4" />
          Cancel
        </button>
      </div>
      {error && <p className="mt-1.5 text-sm text-red-400">{error}</p>}
    </div>
  );
}
