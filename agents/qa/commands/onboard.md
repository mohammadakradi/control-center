---
description: Set up QA for this project — install browser tooling, write .qa/config.json, establish the base URL and production origins, and verify the browser can reach the app. Safe to re-run.
argument-hint: [base url]
model: claude-sonnet-5
---

Onboard the `qa` agent to this project. Base URL hint: **$ARGUMENTS**

Follow `${CLAUDE_PLUGIN_ROOT}/rules/qa-rules.md`. This command is setup only — it runs no
scenarios.

## Steps

1. **Install browser tooling.**
   `bash ${CLAUDE_PLUGIN_ROOT}/scripts/ensure-playwright.sh`
   It prints one line of JSON and always exits 0. The MCP server drives your installed Chrome;
   the bundled chromium it installs is what generated specs run on. If `chrome` comes back
   empty, say so — a headed `/qa:auth` needs a real browser.

2. **Find the app.** Determine how this project runs and on which port: `package.json`
   scripts, `docker-compose.yml`, `.env.example`, the project's `CLAUDE.md`. Derive the dev
   base URL. Don't start the server — just establish the command and the URL.

3. **Write `.qa/config.json`.** Create it if absent; merge rather than overwrite if present.

   ```json
   {
     "baseUrl": "http://localhost:3000",
     "startCommand": "pnpm dev",
     "productionOrigins": [],
     "headless": true,
     "viewport": "1440x900",
     "browser": "chrome",
     "testIdAttribute": "data-testid",
     "timeouts": { "action": 10000, "navigation": 60000 },
     "blockedOrigins": ""
   }
   ```

   - `testIdAttribute` — take it from what the codebase actually uses; grep for `data-testid`,
     `data-test`, `data-cy` and report which won.
   - `productionOrigins` — **ask the user** for their production and staging origins. This is
     what arms the write-guard (rule 8); left empty, it never fires. Say that plainly rather
     than leaving them to discover it.
   - `blockedOrigins` — offer to block third-party analytics/payment hosts so test runs don't
     generate real events. Semicolon-separated.

4. **Scaffold the working directories** and keep secrets out of git. Create `.qa/scenarios/`,
   `.qa/runs/`, `.qa/bugs/`, `.qa/specs/`, `.qa/artifacts/`, and add to `.gitignore`:

   ```
   .qa/auth/
   .qa/artifacts/
   .qa/runs/
   ```

   `.qa/auth/` holds a live session and secrets — committing it is a credential leak. Scenarios,
   specs and bugs are worth committing; runs and artifacts are noise.

5. **Verify the browser reaches the app.** If the app is already running, `browser_navigate` to
   the base URL and `browser_snapshot`. Report the page title and whether it landed on a login
   page. If the app isn't running, say so and name the start command — don't start it yourself.

6. **Note whether auth is needed.** If the base URL redirects to a login page, tell the user to
   run `/qa:auth <login-url>` before their first scenario.

7. **Report** what you configured, what the browser saw, and the exact next command to run.
