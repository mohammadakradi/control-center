"use client";

import { useState, type FormEvent } from "react";
import {
  ExternalLink,
  KeyRound,
  ShieldCheck,
  Terminal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { TokenStatus } from "@/lib/secrets";
import { CardSection, Chip } from "@/components/ui-cards";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyField } from "@/components/ui/copy-field";

const SETUP_TOKEN_CMD = "claude setup-token";
const CONSOLE_KEYS_URL = "https://platform.claude.com/settings/keys";
const PLAN_HELP_URL =
  "https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan";

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
  const [saved, setSaved] = useState<{ warning?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
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
      setSaved({ warning: data.warning });
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setError(null);
    setSaved(null);
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
        Tasks you dispatch run on your own Anthropic credential — nobody else&apos;s.
        It&apos;s encrypted on the server and can never be read back, only replaced or
        removed.
      </p>

      {!vaultReady && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            The server has no <code className="font-mono">SECRETS_MASTER_KEY</code>{" "}
            configured, so token storage is disabled. See{" "}
            <code className="font-mono">.env.example</code>.
          </span>
        </div>
      )}

      {/* Where to get a token. Two routes with different billing — the subscription
          route can't be a button: `claude setup-token` needs a real terminal. */}
      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-sunken p-4">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-strong">
            <Terminal className="size-4 text-accent" aria-hidden="true" />
            Use your Claude plan
          </h3>
          <p className="mt-1 text-xs text-fg-subtle">
            Runs on your Pro/Max subscription limits. Run this in your terminal, approve
            in the browser, then paste the <code className="font-mono">sk-ant-oat…</code>{" "}
            value it prints:
          </p>
          <div className="mt-2.5">
            <CopyField value={SETUP_TOKEN_CMD} label="setup-token command" />
          </div>
          <a
            href={PLAN_HELP_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            Claim your monthly Agent SDK credit
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>

        <div className="rounded-xl border border-line bg-sunken p-4">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-strong">
            <KeyRound className="size-4 text-violet" aria-hidden="true" />
            Use an API key
          </h3>
          <p className="mt-1 text-xs text-fg-subtle">
            Usage-based billing on your Anthropic account. Create a key, then paste it
            below. Pick a long expiry or <em>Never</em> — the runner needs it long-lived.
          </p>
          <div className="mt-2.5">
            <a
              href={CONSOLE_KEYS_URL}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClasses("secondary", "sm")}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Create a key at Anthropic
            </a>
          </div>
        </div>
      </div>

      <form onSubmit={save} className="mt-5 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="anthropic-token" className="text-sm font-medium text-fg-muted">
            {status.configured ? "Replace token" : "Paste your token or key"}
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
          <p className="text-xs text-fg-faint">
            We detect which kind it is from the prefix and verify it with Anthropic
            before saving.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {saved &&
          (saved.warning ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn"
              role="status"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>Token saved, but not verified: {saved.warning}.</span>
            </div>
          ) : (
            <p className="text-sm text-ok" role="status">
              Token verified and saved. Your tasks now run on this credential.
            </p>
          ))}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={!vaultReady || !token.trim()}
          >
            {saving
              ? "Verifying…"
              : status.configured
                ? "Replace token"
                : "Save token"}
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
