# Scenario format

The `qa` agent runs scenarios written in the format the `fe` and `swe` agents already emit to
`.fe/test-scenarios/<slug>.md` and `.swe/test-scenarios/<slug>.md`. **Those files run as-is** —
no conversion step. `/qa:test .fe/test-scenarios/checkout.md` just works.

Scenarios the QA agent writes itself (`/qa:scenario`) land in `.qa/scenarios/<slug>.md` and add
an optional front-matter block that removes guesswork about where and as whom to run.

## What the agent needs from a scenario

A step is runnable when it says **what to do** and **what should then be true**. The Expected
line is not decoration — it is the entire basis of the verdict (rule 3). A step without one
gets reported as a scenario defect.

## Front matter (optional, `/qa:scenario` writes it)

```yaml
---
feature: <what this covers>
base_url: http://localhost:3000     # overrides .qa/config.json baseUrl
auth: required | none               # required -> storageState must be valid before the run
viewports: [1440x900, 390x844]      # run the Responsive section at each
tags: [smoke, checkout]
---
```

## Body

````markdown
# Test scenario: <feature / fix name>

_Task: <one line on what changed> · <date>_

## Setup / preconditions
- <state the app must be in: env, data, logged-in user, feature flag>
- Start the app: `<exact command>` → open <http://localhost:PORT/route>

## Happy path
1. <action — e.g. "Open /dashboard">
   - **Expected:** <observable result — what should appear, where, in which state>
2. <action — e.g. "Click the primary 'Save' button">
   - **Expected:** <observable result>

## Responsive
1. Resize to mobile width (~390px).
   - **Expected:** <nav collapses, no overflow/clipping, tap targets adequate>
2. Resize to desktop (≥1280px).
   - **Expected:** <intended desktop layout>

## Accessibility
1. Navigate the change with the keyboard only (Tab / Shift+Tab / Enter / Esc).
   - **Expected:** <every control reachable in logical order, visible focus ring, actions fire>

## Edge / failure cases
1. <action that hits a boundary — very long title, empty list, forced error>
   - **Expected:** <graceful result; no layout break>

## What success looks like
<one or two sentences>
````

## Writing steps the browser can actually perform

- **Name controls the way a user would** — "the **Save** button", "the **Email** field". That
  maps directly onto the accessible name in the snapshot. A CSS selector in a scenario is a
  smell: it tests the implementation, and it breaks on restyling.
- **One action per step.** "Fill the form and submit and check the email" is three verdicts
  pretending to be one, and when it fails you can't tell which part broke.
- **Expected results must be observable in the page.** "The record is saved" is not observable;
  "a toast reads *Saved*, and the row appears in the table with status *Active*" is.
- **Secrets never appear literally.** Write `<secret>QA_PASSWORD</secret>` and put the value in
  `.qa/auth/secrets.env` (rule 11).
- **Mark deliberately-skippable steps** with `(optional)` so a missing precondition produces
  SKIPPED rather than FAIL.
