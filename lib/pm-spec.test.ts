/**
 * Specs for reading pm task files. The load-bearing behavior is `targetNamespace`: the file
 * modal and the backlog both route a spec by it, so the same file must always reach the same
 * agent. The rest guards the parser against real-world frontmatter (quotes, CRLF, lists,
 * missing fields) — it feeds a database column now, not just a chip label.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  isPmTaskPath,
  isPmTaskSpec,
  isSpecAssignee,
  parseFrontmatter,
  specBody,
  specTitle,
  targetNamespace,
} from "./pm-spec";

const SPEC = `---
title: Per-project backlog — data model
stack: backend
assignee: swe
priority: P1
depends_on: []
---

# Per-project backlog — data model

## Issue
No backlog exists.
`;

test("parseFrontmatter reads the fields a spec actually carries", () => {
  assert.deepEqual(parseFrontmatter(SPEC), {
    title: "Per-project backlog — data model",
    stack: "backend",
    assignee: "swe",
    priority: "P1",
    depends_on: "[]",
  });
});

test("keys are lowercased and quotes are stripped", () => {
  const fm = parseFrontmatter(`---\nTitle: "Quoted title"\nStack: 'frontend'\n---\n`);
  assert.equal(fm.title, "Quoted title");
  assert.equal(fm.stack, "frontend");
});

test("no frontmatter is empty, not a throw", () => {
  assert.deepEqual(parseFrontmatter("# Just a heading\n\nbody"), {});
  assert.deepEqual(parseFrontmatter(""), {});
  // A `---` that isn't at the very start is a horizontal rule, not frontmatter.
  assert.deepEqual(parseFrontmatter("intro\n---\ntitle: nope\n---\n"), {});
});

test("CRLF frontmatter parses (a spec can be written on Windows)", () => {
  const fm = parseFrontmatter("---\r\ntitle: Windows spec\r\nassignee: fe\r\n---\r\nbody");
  assert.equal(fm.title, "Windows spec");
  assert.equal(fm.assignee, "fe");
});

test("targetNamespace: explicit assignee wins over stack", () => {
  assert.equal(targetNamespace({ assignee: "fe", stack: "backend" }), "fe");
  assert.equal(targetNamespace({ assignee: "swe", stack: "frontend" }), "swe");
  assert.equal(targetNamespace({ assignee: "SWE" }), "swe");
});

test("targetNamespace: frontend stack goes to fe, everything else to swe", () => {
  assert.equal(targetNamespace({ stack: "frontend" }), "fe");
  assert.equal(targetNamespace({ stack: "Frontend" }), "fe");
  assert.equal(targetNamespace({ stack: "services" }), "swe");
  assert.equal(targetNamespace({}), "swe");
  // An assignee naming an agent that doesn't take specs must not become the namespace.
  assert.equal(targetNamespace({ assignee: "pm" }), "swe");
});

test("isSpecAssignee only admits the two agents that take specs", () => {
  assert.equal(isSpecAssignee("fe"), true);
  assert.equal(isSpecAssignee("swe"), true);
  assert.equal(isSpecAssignee("pm"), false);
  assert.equal(isSpecAssignee(undefined), false);
});

test("isPmTaskSpec accepts task files and rejects the request index", () => {
  const dir = ".pm/tasks/20260811-113836-backlog";
  assert.equal(isPmTaskSpec(`${dir}/03-backend-backlog.md`), true);
  assert.equal(isPmTaskSpec(`${dir}/index.md`), false);
  assert.equal(isPmTaskSpec(`${dir}/INDEX.md`), false);
  assert.equal(isPmTaskSpec("docs/notes.md"), false);
  // Nested project (a workspace member) still matches.
  assert.equal(isPmTaskPath(`portal/${dir}/01-a.md`), true);
});

test("specTitle prefers frontmatter, then a heading, then the filename", () => {
  assert.equal(specTitle(SPEC, "a/03-backlog.md"), "Per-project backlog — data model");
  assert.equal(
    specTitle("---\nstack: backend\n---\n\n## Fix the thing\n", "a/03-backlog.md"),
    "Fix the thing",
  );
  assert.equal(specTitle("plain body, no heading", "a/03-backlog.md"), "03-backlog");
  assert.equal(specTitle("", "a/b/07-some-task.markdown"), "07-some-task");
  // An empty `title:` must not produce an empty row title.
  assert.equal(specTitle('---\ntitle: ""\n---\nbody', "a/09-x.md"), "09-x");
});

test("specTitle ignores a heading-looking line inside the frontmatter", () => {
  assert.equal(specTitle("---\nstack: backend\n---\n# Real heading\n", "a/1-x.md"), "Real heading");
});

test("specBody drops the frontmatter so a preview starts at the prose", () => {
  // A backlog item stores the file verbatim, so without this the first 160 characters of
  // every synced item are `--- title: … stack: … assignee: …`.
  assert.equal(specBody(SPEC).startsWith("# Per-project backlog"), true);
  assert.equal(specBody(SPEC).includes("assignee: swe"), false);
});

test("specBody leaves a file with no frontmatter alone", () => {
  assert.equal(specBody("Just a body.\n"), "Just a body.\n");
  assert.equal(specBody(""), "");
  // A horizontal rule mid-document is not a frontmatter fence.
  assert.equal(specBody("# Title\n\n---\n\nMore.\n"), "# Title\n\n---\n\nMore.\n");
});
