---
title: Pin Turbopack's project root so a stray lockfile can't silently mis-trace the build
stack: devops
assignee: swe
priority: P2
depends_on: []
---

# Pin Turbopack's project root

## Issue
`install.sh` and `control-center.sh` build the app deep under the user's home directory
(`~/.control-center/.update.<pid>/app`, `~/.control-center/.install.<pid>/app`). Next/Turbopack
auto-infers the project root by walking up from the build directory looking for
`pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `bun.lock(b)` (see
`node_modules/next/dist/docs/.../turbopack.md`, "Root directory"). Any unrelated lockfile
sitting in a user's home directory — plausible on a lot of developer machines — could make
Turbopack infer the wrong root. Next's own docs identify this exact misconfiguration as the
cause of "unexpected file in NFT list" / "the whole project was traced unintentionally"
warnings — the same warning already visible (so far harmlessly) in a real build log from this
project, on `./next.config.ts` via `lib/discovery/projects.ts`. `next.config.ts` currently only
sets `serverExternalPackages` and does not pin the root.

## Goal
The build's project root is always the app directory itself, never inferred from whatever
lockfile Turbopack happens to find first while walking up the filesystem — so a stray lockfile
elsewhere on a user's machine can't silently change what gets traced/bundled.

## Suggested solution
Add `turbopack: { root: <absolute path to the app directory> }` to `next.config.ts` (e.g.
`path.join(__dirname)` / `process.cwd()`, however this repo's convention resolves absolute
paths elsewhere — see `lib/config.ts` for the existing pattern). Confirm the "unexpected file
in NFT list" warning disappears from a clean build.

## Affected areas
- `next.config.ts` — currently only sets `serverExternalPackages: ["better-sqlite3"]`.
- `infra/release/install.sh` and `infra/release/control-center.sh` (`apply_update()`) — both
  build in a temp directory nested under `~/.control-center`, which is the scenario where a
  stray ancestor lockfile could matter.
