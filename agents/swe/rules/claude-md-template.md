# CLAUDE.md Template

Onboarding writes a project `CLAUDE.md` using this structure. Fill every section from what
you actually observed in the repo and from running the baseline commands. Omit a section
only if it genuinely doesn't apply (and say why if non-obvious).

When a `CLAUDE.md` already exists, **merge** into it: update the managed sections below,
preserve anything the team wrote outside them, and don't duplicate. Wrap the sections this
plugin owns between the markers shown so future onboarding runs can update them cleanly.

---

```markdown
# <Project Name>

<!-- swe:begin (managed by swe-agent — safe to re-generate) -->

## Project overview
<2–3 lines: what this project is and does.>

## Stack & tooling
- Language(s): <...>
- Framework(s): <...>
- Package manager: <npm / pnpm / pip / uv / cargo / go / ...>
- Notable libraries: <...>

## Build / test / run
> Commands below were run during onboarding; baseline status noted.
- Install: `<cmd>`
- Build: `<cmd>`  (baseline: ✅ / ❌ / n/a)
- Test: `<cmd>`  (baseline: ✅ / ❌ / n/a)
- Lint / format: `<cmd>`
- Run locally: `<cmd>`

## Architecture map
- `<dir>/` — <purpose>
- `<dir>/` — <purpose>
- Entry point(s): `<file>`
- Tests live in: `<dir>`

## Code graph (graphify)
A queryable code knowledge graph lives at `graphify-out/graph.json`. To understand structure
or relationships, query it instead of brute-force reading/grepping (far fewer tokens):
- `graphify query "<question>"` · `graphify explain "<node>"` · `graphify path "<A>" "<B>"` ·
  `graphify affected "<node>"` (blast radius). Overview: `graphify-out/GRAPH_REPORT.md`.
- Refresh after structural changes: `graphify update .` (no LLM). Rebuild if missing:
  `graphify extract . --no-cluster`.

## Conventions
- Code style: <formatter/linter and any deviations>
- Naming: <patterns observed>
- Commit messages: <style observed, e.g. Conventional Commits>
- Anything non-obvious a contributor must know.

## Agent operating rules
This project is worked on by the swe-agent. For each request it follows a workflow with
two approval gates:
**investigate → plan & decompose 🚦(you approve) → build task-by-task (test + security each) → independent review → report + test scenario 🚦(you approve) → commit**.
Pushing/opening a PR is separate (`/swe:ship`).

Core rules: 1. Onboard before acting. 2. Match project conventions. 3. Small, reviewable
diffs. 4. Test-backed changes (no untested behavior ships). 5. Verify before claiming done.
6. Git is gated — commit only after you approve; never the default branch (a hook enforces
this). 7. Keep this file current. 8. Ask only when genuinely blocked. 9. Be honest about
scope/uncertainty. 10. Read/update `.swe/notes.md`. 11. Plan & decompose every request.
12. Verify security with tools (scanners), not just reasoning. 13. Two independent review
lenses before reporting (`reviewer` + `security-auditor`). 14. Deliver a nutshell + a
`.swe/test-scenarios/` doc. 15. Long-horizon work runs on a `.swe/epics/` plan. 17. Use the
`graphify` code graph (`graphify-out/`) to understand structure/relationships instead of
brute-force search; refresh with `graphify update .` after structural changes.

<!-- swe:end -->
```

---

Notes:
- Keep it concise — `CLAUDE.md` is loaded into context every session; bloat is a cost.
- Prefer exact, copy-pasteable commands over prose.
- If the repo already has a strong `README` or `CONTRIBUTING`, point to it rather than
  duplicating large chunks.
