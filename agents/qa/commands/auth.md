---
description: Capture a logged-in browser session to .qa/auth/storageState.json so QA runs and generated specs can test authenticated pages. Opens a real browser for you to log in by hand.
argument-hint: <login url> [--wait-for-url <substring>] [--wait-for-selector <sel>]
model: claude-sonnet-5
---

Capture a logged-in session. Login target: **$ARGUMENTS**

Credentials are typed by the user into a real browser window. They never pass through your
context, and you never ask for them (rule 11).

## Steps

1. **Resolve the login URL** from `$ARGUMENTS`, else `baseUrl` + the login path found during
   onboarding. If you can't determine it, ask — one question, not a guess.

2. **Work out the success signal** so the script knows when login finished. Best to worst:
   - `--wait-for-selector` on something only a logged-in user sees (avatar, sign-out button).
     Grep the codebase for it, or dispatch `qa:flow-explorer`.
   - `--wait-for-url` on a substring of the post-login route (`/dashboard`).
   - Neither — the script falls back to "navigated away from the login URL and has cookies",
     which is right for most apps and wrong for a single-page login that never changes URL.

3. **Run the capture in the background** so the user can actually use the window:

   ```bash
   QA_PROJECT_DIR="$PWD" node "${CLAUDE_PLUGIN_ROOT}/scripts/save-auth.mjs" \
     "<login-url>" --wait-for-selector "<sel>" --timeout 180
   ```

   Then tell the user, in one line, that a browser window is open and waiting for them to log
   in. Don't narrate further while it waits.

4. **Confirm the capture.** On success the script prints JSON with the cookie count and the
   origins stored. Zero cookies means the login didn't take — report that rather than claiming
   success. On timeout, nothing is written; say what the success signal was and offer to retry
   with a different one.

5. **Verify it actually works** — the only proof that matters. `browser_navigate` to an
   authenticated route and `browser_snapshot`: you should see the app, not a login form.
   Report which route you checked.

6. **Remind the user** that `.qa/auth/` is gitignored and that the session will expire; when a
   run later reports being bounced to login, this command is the fix.
