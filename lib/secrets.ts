import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./config";

/**
 * Per-user Anthropic token vault.
 *
 * Tokens live OUTSIDE the DB, one AES-256-GCM-encrypted file per user under
 * `data/secrets/` (dir 0700, files 0600, all gitignored via /data). The master key
 * comes from the server-only `SECRETS_MASTER_KEY` env var; without it the vault
 * refuses to store or read tokens. Decrypted values never leave the server process:
 * `getUserToken` is called only by the runner to build a task's subprocess env, and
 * the settings API exposes nothing beyond `{ configured, kind, last4 }`.
 */

const SECRETS_DIR = resolve(DATA_DIR, "secrets");
const ALGO = "aes-256-gcm";

/** How the token is handed to the Claude subprocess: CLAUDE_CODE_OAUTH_TOKEN
 *  (subscription token from `claude setup-token`) vs ANTHROPIC_API_KEY. */
export type TokenKind = "oauth" | "api-key";

export type TokenStatus =
  | { configured: false }
  | { configured: true; kind: TokenKind; last4: string };

type Envelope = {
  v: 1;
  kind: TokenKind;
  last4: string;
  iv: string; // base64
  tag: string; // base64
  data: string; // base64 ciphertext
};

export class SecretsError extends Error {}

/** The master key, or null when unset/invalid. Read per call — cheap, and it keeps
 *  the key out of module state. */
function masterKey(): Buffer | null {
  const raw = process.env.SECRETS_MASTER_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

/** True when the vault is usable (master key present and well-formed). */
export function secretsConfigured(): boolean {
  return masterKey() !== null;
}

function requireKey(): Buffer {
  const key = masterKey();
  if (!key) {
    throw new SecretsError(
      "SECRETS_MASTER_KEY is not configured (32 bytes, base64 — see .env.example). " +
        "Refusing to handle tokens without it.",
    );
  }
  return key;
}

/** User ids are `user_<uuid-slice>`; anything else is rejected before it can reach
 *  the filesystem (no path traversal via a crafted id). */
function fileFor(userId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw new SecretsError(`invalid user id: ${userId}`);
  }
  return resolve(SECRETS_DIR, `${userId}.json`);
}

/** Encrypt and store a user's token, replacing any previous one. */
export function setUserToken(userId: string, token: string, kind: TokenKind): void {
  const key = requireKey();
  const file = fileFor(userId);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: 16 });
  // Bind the ciphertext to this user id: a file copied to another user's name
  // fails authentication instead of silently running tasks on the wrong token.
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const envelope: Envelope = {
    v: 1,
    kind,
    last4: token.slice(-4),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };

  mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  // Write-then-rename so a crash can't leave a truncated envelope; chmod after
  // rename because writeFileSync's `mode` only applies to newly created files.
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

function readEnvelope(userId: string): Envelope | null {
  let raw: string;
  try {
    raw = readFileSync(fileFor(userId), "utf8");
  } catch {
    return null;
  }
  try {
    const env = JSON.parse(raw) as Envelope;
    return env && env.v === 1 && env.data && env.iv && env.tag ? env : null;
  } catch {
    return null;
  }
}

/** Safe metadata for the settings UI — never the token. */
export function getUserTokenStatus(userId: string): TokenStatus {
  const env = readEnvelope(userId);
  if (!env) return { configured: false };
  // "Configured" must mean "actually usable", not merely "a file exists". A rotated or
  // missing master key leaves an envelope that can't be decrypted, and reporting it as
  // configured would make `canRunTasks` more permissive than the runner — the one thing
  // it must never be. Report it as unconfigured so the UI prompts for a re-save.
  if (getUserToken(userId) === null) return { configured: false };
  return { configured: true, kind: env.kind, last4: env.last4 };
}

/** Decrypt a user's token. Server/runner-side only — the value must never be
 *  written to the DB, logged, or included in any HTTP response or task event. */
export function getUserToken(
  userId: string,
): { token: string; kind: TokenKind } | null {
  const envelope = readEnvelope(userId);
  if (!envelope) return null;
  // Reads degrade rather than throw: a server missing its master key has no usable
  // token, which is exactly what `null` means. (Writes still throw — see setUserToken —
  // because silently not storing a token the user just pasted would be worse.)
  const key = masterKey();
  if (!key) return null;
  try {
    // Pin the tag length so a crafted envelope can't downgrade to a short GCM tag.
    const decipher = createDecipheriv(ALGO, key, Buffer.from(envelope.iv, "base64"), {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(userId, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const token = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return { token, kind: envelope.kind };
  } catch {
    // Wrong master key or tampered file — treat as not configured rather than
    // leaking crypto errors upward.
    return null;
  }
}

/** Remove a user's stored token (no-op if none). */
export function clearUserToken(userId: string): void {
  rmSync(fileFor(userId), { force: true });
}

/**
 * Can a task owned by this user actually run? Mirrors the decision the runner's
 * `buildTaskEnv` makes, so the web app can warn (and refuse to dispatch) up front
 * instead of letting the user discover it when the session dies. Keep the two in
 * sync — this one must never be more permissive than the runner.
 */
export function canRunTasks(userId: string): boolean {
  if (process.env.ALLOW_SHARED_TOKEN_FALLBACK === "1") return true;
  return getUserTokenStatus(userId).configured;
}
