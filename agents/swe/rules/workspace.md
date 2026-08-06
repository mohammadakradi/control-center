# Multi-repo Workspaces

A **workspace** is one logical project made of several repos/folders that work together —
e.g. a backend API, a frontend app, and background services. The user defines which folders
are members; the agent onboards all of them and then works across them as one system.

Different workspaces stay isolated from each other. Repos *within* a workspace are
intentionally connected.

---

## Defining a workspace

Members are declared in **`.swe/workspace.json`** at the **workspace root** (the folder you
run `/swe:workspace` from, and where the workspace-level `CLAUDE.md` lives):

```json
{
  "name": "Acme Platform",
  "members": [
    { "path": "backend",  "role": "REST API + DB (NestJS, Postgres)" },
    { "path": "frontend", "role": "Web app (Next.js)" },
    { "path": "worker",   "role": "Background jobs (Node, BullMQ)" }
  ]
}
```

- `path` — relative to the workspace root, or an absolute path.
- `role` — a short human description. The user can give it; otherwise the agent fills it
  in during onboarding.

### Session access requirement
Claude Code can only read/write folders the session can see. So:
- If all members live under one parent folder, launch Claude Code from that parent.
- If they're scattered, add each one to the session with `/add-dir <path>` (or launch with
  `--add-dir`). The agent should remind the user when a member folder isn't accessible.

---

## Onboarding a workspace

Two levels, both produced by the `onboard` skill in workspace mode:

1. **Each member** is onboarded individually → its own `CLAUDE.md` in that repo (stack,
   build/test/run, conventions — exactly as for a single repo). Members can be onboarded
   in parallel via the `explorer` subagent.
2. **The workspace root** gets a workspace-level `CLAUDE.md` that maps the *system*, not
   any single repo:

```markdown
# <Workspace Name> — Workspace

<!-- swe:begin -->

## Members
| Folder      | Role                          | Details |
|-------------|-------------------------------|---------|
| `backend/`  | REST API + DB (NestJS)        | see `backend/CLAUDE.md` |
| `frontend/` | Web app (Next.js)             | see `frontend/CLAUDE.md` |
| `worker/`   | Background jobs (Node)        | see `worker/CLAUDE.md` |

## How they connect
- Frontend calls the backend at `<API base / contract location>`.
- Shared types / API contract live in `<where>` (and how they're kept in sync).
- Data flow: `<who produces/consumes what>` (queues, events, DB ownership).
- Auth/session model across services.

## Running the whole system
- `<docker compose up / turbo dev / per-service commands>`
- Shared env vars and where they're configured.

## Cross-cutting conventions
- Anything that must stay consistent across repos (error formats, versioning, naming).

<!-- swe:end -->
```

Keep it focused on the *seams between repos* — each member's internals stay in that
member's own `CLAUDE.md`.

---

## Working across a workspace

The request workflow (`workflow.md`) applies, with these multi-repo adjustments:

- **Investigate** — trace the request through the whole system, not one repo. A change to
  "the user profile" may span `frontend` (form), `backend` (endpoint + model), and
  `worker` (a job). Search across all member folders.
- **Propose** — the proposal must list **which members change and what in each**, and call
  out anything that must change in lockstep (e.g. an API contract used by both backend and
  frontend).
- **Build & verify** — implement across the affected repos, keeping shared contracts/types
  in sync. Run **each affected member's** tests + lint; run integration/e2e if the
  workspace has it.
- **Report** — one unified, plain-language report for the whole change (the user thinks in
  features, not repos), noting which repos were touched.
- **Commit** 🚦 — per repo. Each affected repo is its own git repo, so create a branch and
  commit **in each one** after the user approves. Use the **same branch name** across repos
  for a single feature so they're easy to correlate. `/swe:ship` then pushes and opens a PR
  **per affected repo** (and should mention the sibling PRs in each PR body).
