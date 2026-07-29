"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProjectActions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rescan() {
    setBusy("rescan");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/rescan`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Rescan failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rescan failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Could not remove the project (${res.status})`);
      router.push("/projects");
    } catch (e) {
      // Without this the spinner used to hang forever on a failed delete.
      setError(e instanceof Error ? e.message : "Could not remove the project");
      setBusy(null);
      setConfirming(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          onClick={rescan}
          disabled={busy !== null}
          loading={busy === "rescan"}
          icon={<RotateCw className="size-4" />}
        >
          {busy === "rescan" ? "Rescanning…" : "Rescan"}
        </Button>

        {confirming ? (
          <>
            <Button
              variant="danger"
              onClick={remove}
              disabled={busy !== null}
              loading={busy === "delete"}
            >
              {busy === "delete" ? "Removing…" : "Confirm remove"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={busy !== null}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="danger"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            disabled={busy !== null}
            icon={<Trash2 className="size-4" />}
          >
            Remove
          </Button>
        )}
      </div>

      {confirming && !error && (
        <p className="text-xs text-fg-faint">
          Removes it from the platform. Your files are untouched.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
