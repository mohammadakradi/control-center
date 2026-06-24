"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddProjectForm() {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse() {
    setPicking(true);
    setError(null);
    try {
      const res = await fetch("/api/fs/pick", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not open the folder picker");
      } else if (body.path) {
        setPath(body.path);
      }
    } catch {
      setError("Could not reach the folder picker");
    } finally {
      setPicking(false);
    }
  }

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
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/moh/Dev/my-project"
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm outline-none focus:border-sky-600"
        />
        <button
          type="button"
          onClick={browse}
          disabled={picking}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        >
          {picking ? "Opening Finder…" : "Browse…"}
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add project"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
