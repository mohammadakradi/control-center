"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
          className="shrink-0 rounded-md p-1.5 text-fg-faint opacity-0 transition-opacity hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
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
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-sunken px-3 py-1.5 text-2xl font-bold tracking-tight text-fg-strong outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-3xl"
        />
        <Button
          variant="primary"
          onClick={save}
          loading={busy}
          icon={<Check className="size-4" />}
        >
          Save
        </Button>
        <Button
          onClick={() => setEditing(false)}
          disabled={busy}
          icon={<X className="size-4" />}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
