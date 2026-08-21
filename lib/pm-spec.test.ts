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
  requestTitle,
  specBody,
  specSourcePath,
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
  // Both extensions, like the scan's own `isIndex` — otherwise we'd offer to dispatch a file
  // the backlog deliberately skipped.
  assert.equal(isPmTaskSpec(`${dir}/index.markdown`), false);
  assert.equal(isPmTaskSpec("docs/notes.md"), false);
  // Nested project (a workspace member) still matches.
  assert.equal(isPmTaskPath(`portal/${dir}/01-a.md`), true);
});

test("specSourcePath returns the key the backlog sync would have stored", () => {
  const dir = ".pm/tasks/20260811-113836-backlog";
  assert.equal(specSourcePath(`${dir}/03-backend-backlog.md`), `${dir}/03-backend-backlog.md`);
  // Paths are copied out of agent prose, so a `./` prefix is the one thing worth repairing.
  assert.equal(specSourcePath(`./${dir}/03-backend-backlog.md`), `${dir}/03-backend-backlog.md`);
  assert.equal(specSourcePath(`${dir}/07-a.markdown`), `${dir}/07-a.markdown`);
});

test("specSourcePath refuses anything the root scan would not have keyed", () => {
  const dir = ".pm/tasks/20260811-113836-backlog";
  // A workspace member's spec: a real spec the modal can show, but only the project root's
  // `.pm/tasks/` is scanned, so no row carries this path — and matching it loosely would link
  // the run to another project's identically-named file.
  assert.equal(specSourcePath(`portal/${dir}/01-a.md`), null);
  assert.equal(specSourcePath(`${dir}/index.md`), null);
  assert.equal(specSourcePath(`${dir}/index.markdown`), null);
  // The scan keys `<request>/<file>` and nothing deeper or shallower.
  assert.equal(specSourcePath(`${dir}/sub/01-a.md`), null);
  assert.equal(specSourcePath(".pm/tasks/01-a.md"), null);
  assert.equal(specSourcePath(".fe/test-scenarios/backlog-page.md"), null);
  assert.equal(specSourcePath(""), null);
  // The scan imports markdown only, so nothing else can have a row to match.
  assert.equal(specSourcePath(`${dir}/01-a.txt`), null);
  assert.equal(specSourcePath(`${dir}/01-a.md/`), null);
  // The paths come out of agent prose; the key is stored verbatim, so casing is not repaired.
  assert.equal(specSourcePath(".PM/tasks/req/01-a.md"), null);
  assert.equal(specSourcePath(".pm/Tasks/req/01-a.md"), null);
});

test("specSourcePath accepts the extension in any case, since the scan would have", () => {
  // `scanPmSpecs`'s own `isMarkdown` is case-insensitive, so a row can exist under `.MD` —
  // refusing it here would leave that spec permanently unable to find its own item.
  assert.equal(specSourcePath(".pm/tasks/req/01-a.MD"), ".pm/tasks/req/01-a.MD");
  assert.equal(specSourcePath(".pm/tasks/req/01-a.Markdown"), ".pm/tasks/req/01-a.Markdown");
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

// ------------------------------------------------------- naming a request folder

test("requestTitle prefers the index's frontmatter title, then its heading", () => {
  assert.equal(
    requestTitle("---\ntitle: Grouping work by feature\n---\n# Something else\n", "20260821-135656-x"),
    "Grouping work by feature",
  );
  assert.equal(
    requestTitle("# Feature grouping, branches, and parallel runs\n\nRequest…\n", "20260821-135656-x"),
    "Feature grouping, branches, and parallel runs",
  );
});

test("with no readable index, the folder name becomes the name", () => {
  // The timestamp prefix is noise in a heading, and this is the fallback every project without
  // an index.md gets — including one whose index the scan refused to read.
  assert.equal(
    requestTitle(null, "20260821-135656-feature-grouping-branches-parallel"),
    "Feature grouping branches parallel",
  );
  // Date-only folders (the older layout) and underscores are handled too.
  assert.equal(requestTitle(null, "20260821-tidy_up_the_docs"), "Tidy up the docs");
  // Something that isn't the pm shape at all is still readable rather than blank.
  assert.equal(requestTitle(null, "adhoc"), "Adhoc");
  assert.equal(requestTitle(null, ".pm/tasks/20260821-135656-nested-path"), "Nested path");
});

test("requestTitle never falls back to the word index", () => {
  // `specTitle` would: its last resort is the file stem, which is "index" for every request
  // folder in the project. That is the whole reason this function exists.
  assert.equal(requestTitle("no heading here at all\n", "20260821-135656-real-name"), "Real name");
  assert.equal(requestTitle("", "20260821-135656-real-name"), "Real name");
});

test("a folder whose name is only a timestamp still gets a name", () => {
  // Degenerate but reachable, and pinned so nobody has to guess: the date prefix comes off and
  // the time is what is left. Ugly, and still better than a blank group heading.
  assert.equal(requestTitle(null, "20260821-135656"), "135656");
});
