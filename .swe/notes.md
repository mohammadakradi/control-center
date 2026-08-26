# Decision & Gotcha Journal — index

Reusable lessons that aren't obvious from the code: environment gotchas, surprising behaviors,
and the rationale behind decisions.

**This file is an index (engineering rule 10).** The notes live in `.swe/notes/`. Read this
index, then open **only** the topics your request touches — or `grep -ril '<term>' .swe/notes/`
to find a note whose topic you don't know. **Never read the whole directory**: it is ~370 KB,
and a full read is ~90k tokens that then ride in the prompt of every remaining call in the
session. Budgets: this index 8 KB, each topic file 30 KB.

## Start here
| Topic | Covers |
|---|---|
| [architecture-facts](notes/architecture-facts.md) | The short list of load-bearing facts worth knowing before changing anything |
| [cost-and-context](notes/cost-and-context.md) | **Why these budgets exist** — the measured token spend, where it went, and the per-task run caps |
| [architecture-map](notes/architecture-map.md) | The full annotated directory map |
| [build-and-environment](notes/build-and-environment.md) | Every command, the Docker dev notes, the container hop, per-user Claude auth |

## Subsystems (the "why it is built this way" notes)
| Topic | Covers |
|---|---|
| [features](notes/features.md) | The `features` entity, branch naming, merge-back lifecycle, managing groups, the grouped UI |
| [backlog](notes/backlog.md) | The `.pm/tasks/` spec sync, status precedence, caps, agent-filed items + the nonce fence, parallel runs |
| [file-reads-and-git](notes/file-reads-and-git.md) | `lib/safe-read.ts` containment and every `lib/git.ts` hardening decision — **including two CRITICAL holes reproduced and knowingly left open** |
| [releases-and-data](notes/releases-and-data.md) | The release workflow, `install.sh`, the update lock, export/import, Settings → Data |
| [task-runs](notes/task-runs.md) | A task's Changes card, turn-end classification, the report card's fix-task offer, skills + attachments |
| [search](notes/search.md) | `lib/search.ts` — the owner-scoping asymmetry, `LIKE` escaping, every bound |
| [mac-app-and-pwa](notes/mac-app-and-pwa.md) | The native bundle, the Swift/launcher split, the rename off Apple's "Control Center", the PWA |
| [agents-bundling](notes/agents-bundling.md) | Why the swe/fe/pm plugins are vendored into `agents/` and how discovery prefers a CLI copy |

## Dated log (what happened, in order)
Chronological working notes. Useful when you need to know *why* a change was made the way it
was, or what was already tried and rejected. Skip unless the subject is yours.

| Topic | Covers |
|---|---|
| [decisions-1](notes/decisions-1.md) · [decisions-2](notes/decisions-2.md) | Decision log, oldest first |
| [gotchas-1](notes/gotchas-1.md) · [gotchas-2](notes/gotchas-2.md) | Gotcha log — traps, env quirks, things that cost time |
| [log-git-hardening-1](notes/log-git-hardening-1.md) · [log-git-hardening-2](notes/log-git-hardening-2.md) | The `safe-read` / `gitFileDiff` / `gitChanges` / `NO_HOOKS` work as it happened |
| [log-features-1](notes/log-features-1.md) · [log-features-2](notes/log-features-2.md) | The feature entity, branch lifecycle, merge-back honesty, isolation by default |
| [log-releases-1](notes/log-releases-1.md) · [log-releases-2](notes/log-releases-2.md) | The update lock, and getting a published release to a running window |
| [log-task-changes](notes/log-task-changes.md) | The per-task changes panel and `lib/task-root.ts` |
| [log-search](notes/log-search.md) | Global search as it was built |
| [log-uploads](notes/log-uploads.md) | Attachment uploads, incl. the WebKit mitigation applied blind |

## Writing to this journal
Put a new note in the topic file where it belongs; create a topic (and add its row above) if
none fits. Correct or delete a note that has gone stale — a wrong note is worse than none.
Check `wc -c .swe/notes.md .swe/notes/*.md` before you finish; over budget means consolidate
or split, never append.
