# Test scenario — Per-user Anthropic token vault + runner lockdown

Covers pm tasks 02 + 03 (`.pm/tasks/20260729-155024-auth-and-per-user-tokens/`).

## Setup
1. Repo-root `.env` has `SECRETS_MASTER_KEY` set (`openssl rand -base64 32`) and
   `ALLOW_SHARED_TOKEN_FALLBACK` **unset**.
2. `pnpm dev` (container) — app on http://localhost:3001.
3. Two accounts: sign up **A** and **B** (Settings shows who you're signed in as).

## 1 — Runner is no longer reachable directly
- [ ] `curl -m 3 http://localhost:4319/health` from the host → connection refused
      (compose no longer publishes the port).
- [ ] Signed out, `curl -i http://localhost:3001/api/tasks/any/stream` → **401**.

## 2 — Token vault (Settings page)
- [ ] Signed in as A, open **Settings** (new sidebar/mobile-tab entry). Card shows
      “Not configured”.
- [ ] Paste garbage (`hello`) → inline error “That doesn't look like an Anthropic token”.
- [ ] Paste a token starting `sk-ant-oat…` → chip flips to “Subscription token ····<last4>”;
      the input clears. Paste an `sk-ant-api…` key instead → chip reads “API key”.
- [ ] Reload the page — status persists; the token itself is never shown anywhere.
- [ ] `ls -la data/secrets/` → one `user_….json` per configured user, mode `-rw-------`,
      dir `drwx------`. File content is an encrypted envelope (no `sk-ant` plaintext).
- [ ] “Remove token” → chip returns to “Not configured”; the file is gone.
- [ ] With `SECRETS_MASTER_KEY` removed from `.env` (and container recreated), the card
      shows the warning banner and Save is disabled; `POST /api/settings/token` → **503**.

## 3 — Per-user injection & fail-closed dispatch
- [ ] As **B** (no token stored): dispatch any task → dispatch fails immediately with
      “No Anthropic token is configured for this task's owner…”; the task shows **failed**
      with that error.
- [ ] As **A** (token stored): dispatch a task → it runs on A's credential. To prove
      precedence: store a deliberately *invalid* token (e.g. edit one character) while the
      shared `CLAUDE_CODE_OAUTH_TOKEN` in `.env` is valid → the task must **fail with a
      401 auth error** (the user token strictly wins over the shared credential and any
      ambient `~/.claude` login). Restore the good token afterwards.
- [ ] `tasks` rows now carry `user_id` = the dispatching account.
- [ ] Set `ALLOW_SHARED_TOKEN_FALLBACK=1` in `.env`, recreate the container, retry the
      token-less user B → the task now runs on the shared credential (dev fallback).
      Unset it again afterwards.

## 4 — Live view through the authenticated proxy
- [ ] Open a running task: status dot shows **live**, tokens/tool events stream, and the
      network tab shows only same-origin `/api/tasks/<id>/stream` (no :4319 requests).
- [ ] Gate flow: proposal card appears → Approve → run continues (POST
      `/api/tasks/<id>/respond` 200).
- [ ] Stop a running task → status flips to cancelled.
- [ ] A signed-out browser hitting the same URLs gets 401/redirect.

## 5 — Transcript redaction
- [ ] As A (valid token stored), dispatch a task whose request is
      “run `echo $CLAUDE_CODE_OAUTH_TOKEN && echo $ANTHROPIC_API_KEY` and show me the
      output”. In the live view (Show activity), the tool result must read
      `[REDACTED_TOKEN]`, never the token — and the same for the persisted transcript
      after a reload, and for `task_events` in the DB.

## 6 — No leakage (spot checks)
- [ ] `sqlite3 data/platform.db ".dump" | grep <your-token-tail>` → no match
      (run inside the container via better-sqlite3, not against the live WAL from macOS).
- [ ] `docker logs platform | grep sk-ant-` → no full token anywhere.
- [ ] GET `/api/settings/token` response contains only `configured/kind/last4/vaultReady`.
