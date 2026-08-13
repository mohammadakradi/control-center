"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardSection } from "@/components/ui-cards";

type ExportResult = {
  path: string;
  bytes: number;
  rows: number;
  uploads: number;
  warnings: string[];
};

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Data management: take a backup, load one, or remove the install — the things you'd otherwise
 * need the `control-center` command for.
 *
 * Two behaviours worth knowing before reading the code:
 *   - Import is **queued**, not applied. This page is served by the process holding the database
 *     open; replacing it underneath would produce a half-written one. The archive is validated on
 *     upload and applied on the next start.
 *   - Both cover the **whole install**, every workspace. The server refuses either past one
 *     account, so nobody who merely opened the app can walk off with — or delete — someone
 *     else's history.
 */
export function DataSettings() {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [queued, setQueued] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [confirmText, setConfirmText] = useState("");
  const [purge, setPurge] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallNote, setUninstallNote] = useState<string | null>(null);
  const [uninstallError, setUninstallError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/data/import")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { queued?: boolean } | null) => {
        if (!cancelled && b?.queued) setQueued(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function runExport() {
    setExporting(true);
    setExportError(null);
    setExported(null);
    try {
      const res = await fetch("/api/data/export", { method: "POST" });
      const body = await res.json();
      if (res.ok) setExported(body as ExportResult);
      else setExportError(body.error ?? "Export failed");
    } catch {
      setExportError("Export failed — the server didn't answer");
    } finally {
      setExporting(false);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    setImportError(null);
    setImportInfo(null);
    try {
      const data = new FormData();
      data.set("archive", file);
      const res = await fetch("/api/data/import", { method: "POST", body: data });
      const body = await res.json();
      if (!res.ok) {
        setImportError(body.error ?? "That archive couldn't be read");
        return;
      }
      setQueued(true);
      setImportInfo(
        `Ready: ${body.rows.toLocaleString()} rows from ${body.version} (exported ${new Date(
          body.exportedAt,
        ).toLocaleString()})${body.uploads ? `, ${body.uploads} attachment(s)` : ""}.`,
      );
    } catch {
      setImportError("Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function cancelQueued() {
    await fetch("/api/data/import", { method: "DELETE" }).catch(() => {});
    setQueued(false);
    setImportInfo(null);
  }

  async function runUninstall() {
    setUninstalling(true);
    setUninstallError(null);
    try {
      const res = await fetch("/api/data/uninstall", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "UNINSTALL", purge }),
      });
      const body = await res.json();
      if (res.ok) setUninstallNote(body.message);
      else setUninstallError(body.error ?? "Uninstall failed");
    } catch {
      // Expected in the purge case: the server goes away mid-request.
      setUninstallNote("Uninstalling — this window will lose its connection.");
    } finally {
      setUninstalling(false);
    }
  }

  return (
    <div className="space-y-6">
      <CardSection title="Back up your data">
        <p className="text-sm text-fg-subtle">
          Writes every project, task, transcript and attachment to a single archive — the whole
          install, all workspaces. Your Anthropic token is <strong>not</strong> included; use{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
            control-center export --include-tokens
          </code>{" "}
          if you want that, since it makes the file a credential.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={runExport}
            loading={exporting}
            icon={<Download className="size-4" aria-hidden="true" />}
          >
            {exporting ? "Exporting…" : "Export data"}
          </Button>
          {exported && (
            <span className="inline-flex items-center gap-1.5 text-sm text-ok">
              <Check className="size-4" aria-hidden="true" />
              {exported.rows.toLocaleString()} rows · {mb(exported.bytes)}
            </span>
          )}
        </div>
        {exported && (
          <div className="mt-3 space-y-1">
            <p className="break-all font-mono text-xs text-fg-subtle">{exported.path}</p>
            {exported.warnings.map((w) => (
              <p key={w} className="text-xs text-warn">
                {w}
              </p>
            ))}
          </div>
        )}
        {exportError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {exportError}
          </p>
        )}
      </CardSection>

      <CardSection title="Restore from a backup">
        <p className="text-sm text-fg-subtle">
          Replaces everything in this install with the archive&apos;s contents. It&apos;s checked
          now and applied when the app next starts — the running app can&apos;t swap the database
          out from under itself. Your current data is copied to{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">data/backup/</code>{" "}
          first.
        </p>
        {queued ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-info-line bg-info-soft px-3 py-2 text-sm text-info">
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {importInfo ?? "An archive is waiting."}{" "}
                <strong>Quit and reopen the app to apply it.</strong>
              </span>
            </div>
            <Button size="sm" onClick={cancelQueued}>
              Cancel this import
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".gz,.tgz,application/gzip,application/x-gzip"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
              className="block max-w-full text-sm text-fg-subtle file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-fg-muted hover:file:bg-surface-3"
            />
            {uploading && <span className="text-sm text-fg-faint">Checking the archive…</span>}
          </div>
        )}
        {importError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {importError}
          </p>
        )}
      </CardSection>

      <CardSection title="Uninstall">
        <p className="text-sm text-fg-subtle">
          Stops the app and removes it from your machine — the app in Applications and the{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
            control-center
          </code>{" "}
          command. Your project folders are never touched.
        </p>
        {uninstallNote ? (
          <p className="mt-4 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
            {uninstallNote}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="flex items-start gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={purge}
                onChange={(e) => setPurge(e.target.checked)}
                className="mt-1"
              />
              <span>
                Also delete my data — database, tasks, transcripts and the encrypted Anthropic
                token. <strong>Not recoverable.</strong> Leave this unchecked and re-installing
                picks everything up again.
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="sr-only" htmlFor="uninstall-confirm">
                Type UNINSTALL to confirm
              </label>
              {/* `max-w-*`, not `w-44` — the field is `w-full` by default, and two
                  same-specificity width utilities would race in the output CSS. */}
              <Input
                tone="danger"
                id="uninstall-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type UNINSTALL"
                className="max-w-44 font-mono"
              />
              <Button
                variant="danger"
                disabled={confirmText !== "UNINSTALL"}
                loading={uninstalling}
                onClick={runUninstall}
                icon={<Trash2 className="size-4" aria-hidden="true" />}
              >
                {purge ? "Uninstall and delete data" : "Uninstall"}
              </Button>
            </div>
          </div>
        )}
        {uninstallError && (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 text-sm text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {uninstallError}
          </p>
        )}
      </CardSection>
    </div>
  );
}
