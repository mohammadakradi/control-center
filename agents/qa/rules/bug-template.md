# Bug file format

One file per distinct defect, written to `.qa/bugs/<NN>-<slug>.md`. The front matter matches
the `pm` agent's task template, so `/swe:fix` and `/fe:fix` consume these without translation.

Keep it short. A bug is a brief, not an investigation — the engineer who picks it up does their
own root-causing. What they cannot recreate is what you *saw*, so spend the words there.

````markdown
---
title: <what is broken, stated as the defect>
stack: backend | frontend | services | devops | data | fullstack
assignee: swe | fe
priority: P1 | P2 | P3
depends_on: []
---

# <Title>

## Issue
<What's broken and what the user experiences — 1–3 sentences. Include the concrete evidence:
the console error, the failing request and its status, the element state.>

## Goal
<What correct behaviour looks like — 1–2 sentences, taken from the scenario's Expected.>

## Suggested solution
<Only if the evidence points somewhere specific — the failing endpoint, the undefined value and
where it's read. If it doesn't, say "root cause not established" rather than guessing.>

## Affected areas
- <path or component> — <role in the failure, if known from the stack trace or request>
- <the user-facing flow this breaks>

## Reproduction
1. <exact steps from the scenario, starting at a URL>
2. ...
- **Expected:** <from the scenario>
- **Actual:** <what happened>
- **Environment:** <base url · browser · viewport · logged in as …>
- **Evidence:** `.qa/artifacts/<screenshot>.png` · run `.qa/runs/<report>.md`
````

Guidelines:

- **Priority by user impact, not by how annoying it was to find.** P1 = the flow is unusable or
  data is wrong; P2 = works but visibly broken or degraded; P3 = cosmetic.
- **Assignee** follows the same rule the other agents use: `fe` for frontend-only, `swe`
  otherwise. A 500 behind a broken button is `swe`, even though you found it in the UI.
- **One defect per file.** Three steps failing from one undefined value is one bug.
- **Never file a scenario defect as a product bug** (rule 6). Those go in the report only.
- **No secrets in the reproduction** — reference `<secret>NAME</secret>`, never the value.
