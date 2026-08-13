"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronRight,
  CornerLeftUp,
  Folder,
  FolderGit2,
  House,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

type Entry = {
  name: string;
  path: string;
  isGit: boolean;
  /** Already registered as a project — shown as a hint, still navigable. */
  registered: boolean;
};

type Listing = {
  path: string;
  parent: string | null;
  roots: string[];
  entries: Entry[];
  truncated: boolean;
};

/**
 * In-app folder browser for picking a project directory. Replaces the old native macOS
 * Finder dialog, which couldn't work at all in the Docker dev container (Linux, no GUI).
 *
 * Rows navigate *into* a folder; the footer selects the folder you're currently in. Up walks
 * toward the root, the "Go" field jumps straight to a pasted path (Finder's ⌘⇧G), and extra
 * roots show as chips. Browsing is jailed server-side to `PROJECT_ROOTS` (see `lib/fs-browse`).
 */
export function FolderPicker({
  /** Where to start — usually whatever is typed in the path field. Falls back to the
   *  first browse root if it's outside the jail. */
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  // `dir` is the folder we *want*; `loaded` is the answer we got for one. Keeping the
  // requested dir alongside the result lets `loading` be derived instead of set from inside
  // the effect (which the react-hooks lint rightly rejects as a cascading render).
  const gotoId = useId();
  const [dir, setDir] = useState<string | null>(initialPath?.trim() || null);
  const [loaded, setLoaded] = useState<{
    dir: string | null;
    listing: Listing | null;
    error: string | null;
  } | null>(null);
  const [goto, setGoto] = useState("");
  // A rejected `initialPath` (outside the roots, or deleted) shouldn't dead-end the picker:
  // retry once at the first root. Only the initial load gets that grace — once the user has
  // navigated anywhere themselves, a bad path must report the error instead of quietly moving.
  const usedFallback = useRef(false);

  function navigate(next: string | null) {
    usedFallback.current = true;
    setDir(next);
  }

  useEffect(() => {
    let cancelled = false;
    const qs = dir ? `?path=${encodeURIComponent(dir)}` : "";
    fetch(`/api/fs/list${qs}`)
      .then(async (res) => ({ ok: res.ok, body: await res.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok) {
          setLoaded({ dir, listing: body as Listing, error: null });
          return;
        }
        if (dir !== null && !usedFallback.current) {
          usedFallback.current = true;
          setDir(null); // re-runs this effect against the default root
          return;
        }
        const message =
          (body as { error?: string }).error ?? "Could not read that folder";
        // Keep whatever was on screen: an error deeper in the tree shouldn't blank the list.
        setLoaded((prev) => ({ dir, listing: prev?.listing ?? null, error: message }));
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded((prev) => ({
          dir,
          listing: prev?.listing ?? null,
          error: "Could not reach the server",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [dir]);

  const loading = loaded === null || loaded.dir !== dir;
  const listing = loaded?.listing ?? null;
  const error = loaded?.error ?? null;
  const current = listing?.path ?? null;
  const otherRoots = listing ? listing.roots.filter((r) => r !== listing.path) : [];

  function jump() {
    const target = goto.trim();
    if (!target) return;
    setGoto("");
    navigate(target);
  }

  return (
    <Modal
      label="Select a project folder"
      className="max-w-xl"
      onClose={onClose}
      header={
        <span className="flex min-w-0 items-center gap-2">
          <Folder className="size-4 shrink-0 text-fg-ghost" aria-hidden="true" />
          <span className="truncate font-mono text-sm text-fg">
            {current ?? "Select a project folder"}
          </span>
        </span>
      }
      actions={
        <>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => navigate(listing?.roots[0] ?? null)}
            disabled={!listing || listing.path === listing.roots[0]}
            aria-label="Go to the starting folder"
            title="Starting folder"
          >
            <House className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => listing?.parent && navigate(listing.parent)}
            disabled={!listing?.parent}
            aria-label="Go to the parent folder"
            title="Parent folder"
          >
            <CornerLeftUp className="size-4" aria-hidden="true" />
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <label htmlFor={gotoId} className="sr-only">
          Go to folder path
        </label>
        <Input
          size="sm"
          id={gotoId}
          value={goto}
          onChange={(e) => setGoto(e.target.value)}
          onKeyDown={(e) => {
            // The picker renders outside the Add-project form, but guard anyway: Enter here
            // must jump, never submit a form.
            if (e.key !== "Enter") return;
            e.preventDefault();
            jump();
          }}
          placeholder="/absolute/path/to/folder"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 font-mono"
        />
        <Button size="sm" onClick={jump} disabled={!goto.trim()}>
          Go
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="border-b border-danger-line bg-danger-soft px-4 py-2 text-xs text-danger"
        >
          {error}
        </p>
      )}

      <div className="scroll-thin min-h-40 flex-1 overflow-auto bg-sunken p-2">
        {loading && !listing ? (
          <p className="inline-flex items-center gap-2 p-3 text-sm text-fg-faint">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading folders…
          </p>
        ) : !listing ? (
          <p className="p-3 text-sm text-fg-faint">
            Nothing to browse. Type or paste the folder path instead.
          </p>
        ) : listing.entries.length === 0 ? (
          <p className="p-3 text-sm text-fg-faint">
            No sub-folders here. Select this folder, or go back up.
          </p>
        ) : (
          <ul aria-busy={loading || undefined}>
            {listing.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => navigate(entry.path)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-3"
                >
                  {entry.isGit ? (
                    <FolderGit2 className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  ) : (
                    <Folder className="size-4 shrink-0 text-fg-ghost" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {entry.name}
                  </span>
                  {entry.registered && (
                    <span className="shrink-0 rounded-md border border-muted-line bg-muted-soft px-1.5 py-0.5 text-[11px] text-fg-subtle">
                      Added
                    </span>
                  )}
                  <ChevronRight
                    className="size-4 shrink-0 text-fg-ghost"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}

        {listing?.truncated && (
          <p className="px-3 py-2 text-xs text-fg-faint">
            Only the first folders are listed — this directory has more. Type the path
            instead if you don&apos;t see the one you want.
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-line px-4 py-3">
        {otherRoots.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-faint">
            Other roots:
            {otherRoots.map((root) => (
              <button
                key={root}
                type="button"
                onClick={() => navigate(root)}
                className="max-w-full truncate rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg-strong"
              >
                {root}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 break-all font-mono text-xs text-fg-subtle">
            {current ?? "—"}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!current}
              onClick={() => current && onSelect(current)}
            >
              Select this folder
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
