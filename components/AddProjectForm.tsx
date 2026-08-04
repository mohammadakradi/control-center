"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { FolderPicker } from "@/components/FolderPicker";
import { Button } from "@/components/ui/button";

export function AddProjectForm() {
  const inputId = useId();
  const router = useRouter();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: path.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to add project");
      return;
    }
    setPath("");
    router.refresh();
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor={inputId} className="block text-xs font-medium text-fg-subtle">
          Project folder
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={inputId}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/moh/Dev/my-project"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-fg outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <Button
            type="button"
            onClick={() => setPicking(true)}
            icon={<FolderOpen className="size-4" aria-hidden="true" />}
          >
            Browse…
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {busy ? "Adding…" : "Add project"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
      {/* Outside the <form> on purpose: the picker has its own "go to path" input, and
          Enter in a nested input would otherwise submit this form. */}
      {picking && (
        <FolderPicker
          initialPath={path.trim() || undefined}
          onClose={() => setPicking(false)}
          onSelect={(picked) => {
            setPath(picked);
            setError(null);
            setPicking(false);
          }}
        />
      )}
    </>
  );
}
