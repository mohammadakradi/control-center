"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import type { TokenStatus } from "@/lib/secrets";
import { CardSection, Chip } from "@/components/ui-cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Set / replace / clear the signed-in user's Anthropic token. Write-only by
 *  design: the server never returns the token, only { configured, kind, last4 }. */
export function TokenSettings({
  initialStatus,
  vaultReady,
}: {
  initialStatus: TokenStatus;
  vaultReady: boolean;
}) {
  const [status, setStatus] = useState<TokenStatus>(initialStatus);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setStatus(data as TokenStatus);
      setToken(""); // the token is stored server-side; don't keep it in the field
      setSaved(true);
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setError(null);
    setSaved(false);
    setClearing(true);
    try {
      const res = await fetch("/api/settings/token", { method: "DELETE" });
      if (res.ok) setStatus({ configured: false });
      else setError("Failed to remove the token — try again");
    } catch {
      setError("Failed to remove the token — try again");
    } finally {
      setClearing(false);
    }
  }

  return (
    <CardSection
      title="Anthropic token"
      right={
        status.configured ? (
          <Chip tone="ok" icon={<ShieldCheck className="size-3" />}>
            {status.kind === "oauth" ? "Subscription token" : "API key"} ····
            {status.last4}
          </Chip>
        ) : (
          <Chip icon={<KeyRound className="size-3" />}>Not configured</Chip>
        )
      }
    >
      <p className="text-sm text-fg-subtle">
        Tasks you dispatch run on your own Claude subscription or API billing.
        Paste a subscription token (run{" "}
        <code className="rounded bg-sunken px-1 py-0.5 font-mono text-xs">
          claude setup-token
        </code>{" "}
        once) or an Anthropic API key. It is stored encrypted on the server and
        can never be read back — only replaced or removed.
      </p>

      {!vaultReady && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            The server has no <code className="font-mono">SECRETS_MASTER_KEY</code>{" "}
            configured, so token storage is disabled. See <code className="font-mono">.env.example</code>.
          </span>
        </div>
      )}

      <form onSubmit={save} className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="anthropic-token" className="text-sm font-medium text-fg-muted">
            {status.configured ? "Replace token" : "Token"}
          </label>
          <Input
            id="anthropic-token"
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            required
            disabled={!vaultReady}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {saved && (
          <p className="text-sm text-ok" role="status">
            Token saved. Your tasks now run on this credential.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={!vaultReady || !token.trim()}
          >
            {status.configured ? "Replace token" : "Save token"}
          </Button>
          {status.configured && (
            <Button
              type="button"
              variant="danger"
              onClick={clear}
              loading={clearing}
              icon={<Trash2 className="size-3.5" />}
            >
              Remove token
            </Button>
          )}
        </div>
      </form>
    </CardSection>
  );
}
