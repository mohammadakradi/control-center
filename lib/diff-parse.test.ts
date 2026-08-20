/**
 * Unit tests for the unified-diff parser behind the diff viewer.
 *
 * The fixtures are the shapes `lib/git.ts` actually emits, not textbook diffs — that is the
 * whole point of testing this. Four of them are not `git diff` output at all: `untrackedDiff`
 * synthesizes its own, a mode-only change has no hunks, a binary file is one sentence in two
 * different wordings depending on which branch produced it, and anything past `DIFF_CAP` is
 * sliced mid-line with a marker appended. A parser that only ever saw a modify diff would
 * render every one of those as a blank panel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  countRows,
  diffNotice,
  hunkSides,
  pairRows,
  parseUnifiedDiff,
  type DiffRow,
} from "./diff-parse";

const MODIFY = [
  "diff --git a/lib/ui.ts b/lib/ui.ts",
  "--- a/lib/ui.ts",
  "+++ b/lib/ui.ts",
  "@@ -10,6 +10,7 @@ export function statusColor(status: string) {",
  ' case "done":',
  '-  return "ok";',
  '+  return "success";',
  '+  // renamed for the badge',
  " case \"failed\":",
  '   return "danger";',
  " }",
].join("\n");

test("a modify diff yields rows with both line numbers tracked", () => {
  const parsed = parseUnifiedDiff(MODIFY);
  assert.ok(parsed);
  assert.equal(parsed.hunks.length, 1);
  assert.equal(parsed.hunks[0].range, "@@ -10,6 +10,7 @@");
  assert.equal(parsed.hunks[0].heading, "export function statusColor(status: string) {");

  const rows = parsed.hunks[0].rows;
  assert.deepEqual(
    rows.map((r) => [r.kind, r.oldNo, r.newNo]),
    [
      ["ctx", 10, 10],
      ["del", 11, null],
      ["add", null, 11],
      ["add", null, 12],
      ["ctx", 12, 13],
      ["ctx", 13, 14],
      ["ctx", 14, 15],
    ],
  );
  // The marker character is stripped: it is presentation, and the split view needs the bare
  // content to hand to the highlighter.
  assert.equal(rows[1].text, '  return "ok";');
  assert.equal(parsed.fileState, "modified");
  assert.equal(parsed.truncated, false);
});

test("the header lines are kept, and hunk lines are not among them", () => {
  const parsed = parseUnifiedDiff(MODIFY);
  assert.ok(parsed);
  assert.deepEqual(parsed.headerLines, [
    "diff --git a/lib/ui.ts b/lib/ui.ts",
    "--- a/lib/ui.ts",
    "+++ b/lib/ui.ts",
  ]);
});

test("an untracked file's synthesized diff parses, including the omitted ,1 count", () => {
  // `untrackedDiff` writes `@@ -0,0 +1 @@` for a one-line file, exactly as git does.
  const parsed = parseUnifiedDiff(
    [
      "diff --git a/notes.txt b/notes.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/notes.txt",
      "@@ -0,0 +1 @@",
      "+only line",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.fileState, "new");
  assert.deepEqual(
    parsed.hunks[0].rows.map((r) => [r.kind, r.oldNo, r.newNo, r.text]),
    [["add", null, 1, "only line"]],
  );
});

test("`\\ No newline at end of file` marks the line above it, not a row of its own", () => {
  const parsed = parseUnifiedDiff(
    [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-one",
      "\\ No newline at end of file",
      "+two",
      "\\ No newline at end of file",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.hunks[0].rows.length, 2);
  assert.deepEqual(
    parsed.hunks[0].rows.map((r) => r.noNewline),
    [true, true],
  );
});

test("both binary wordings are recognised and produce a notice, not an empty panel", () => {
  // `untrackedDiff` and `trackedDiff` word this differently — the parser must not care.
  for (const sentence of [
    "Binary file b/logo.png differs",
    "Binary files a/logo.png and b/logo.png differ",
  ]) {
    const parsed = parseUnifiedDiff(
      `diff --git a/logo.png b/logo.png\n${sentence}`,
    );
    assert.ok(parsed, sentence);
    assert.equal(parsed.binary, true, sentence);
    assert.equal(parsed.hunks.length, 0, sentence);
    assert.match(String(diffNotice(parsed)), /Binary file/, sentence);
  }
});

test("a mode-only change has no hunks and says so in words", () => {
  // `chmod +x` on a tracked file: git prints the two mode lines and nothing else, which used
  // to render as a file that opened to nothing.
  const parsed = parseUnifiedDiff(
    [
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.hunks.length, 0);
  assert.deepEqual(parsed.modeChange, { from: "100644", to: "100755" });
  assert.equal(
    diffNotice(parsed),
    "File mode changed from 100644 to 100755. The contents are unchanged.",
  );
});

test("an empty new file says so rather than rendering a blank panel", () => {
  // `untrackedDiff` returns the header and stops when the file has no content, so there is no
  // hunk and no mode line — the same "viewer looks broken" shape as a mode-only change.
  const parsed = parseUnifiedDiff(
    [
      "diff --git a/empty.txt b/empty.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/empty.txt",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.hunks.length, 0);
  assert.equal(diffNotice(parsed), "New file — it is empty.");
});

test("a deleted empty file says so too — it has no hunk and no ---/+++ pair", () => {
  // Verified against the real endpoint: this is the whole diff git produces for it.
  const parsed = parseUnifiedDiff(
    [
      "diff --git a/was-empty.txt b/was-empty.txt",
      "deleted file mode 100644",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.fileState, "deleted");
  assert.equal(diffNotice(parsed), "This file was deleted. It was empty.");
});

test("a submodule diff is ordinary rows — the pointer lines are just content", () => {
  const parsed = parseUnifiedDiff(
    [
      "diff --git a/vendor/lib b/vendor/lib",
      "--- a/vendor/lib",
      "+++ b/vendor/lib",
      "@@ -1 +1 @@",
      "-Subproject commit 1111111111111111111111111111111111111111",
      "+Subproject commit 2222222222222222222222222222222222222222",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.deepEqual(
    parsed.hunks[0].rows.map((r) => r.kind),
    ["del", "add"],
  );
});

test("a diff cut off at the size cap is flagged rather than half-parsed in silence", () => {
  const parsed = parseUnifiedDiff(
    [
      "diff --git a/big.ts b/big.ts",
      "--- a/big.ts",
      "+++ b/big.ts",
      "@@ -1,2 +1,2 @@",
      "-const a = 1;",
      "+const a = 2; // this line was cut mid-w",
      "… (diff truncated)",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.truncated, true);
  assert.equal(countRows(parsed), 2);
});

test("nothing diff-shaped returns null, which is the signal to render the raw text", () => {
  assert.equal(parseUnifiedDiff(""), null);
  assert.equal(parseUnifiedDiff("could not read this file"), null);
  // A bare hunk with no `diff --git` header is still a diff, so it must NOT be null.
  assert.ok(parseUnifiedDiff("@@ -1 +1 @@\n-a\n+b"));
});

test("multiple hunks each restart their own line numbering", () => {
  const parsed = parseUnifiedDiff(
    [
      "@@ -1,2 +1,2 @@",
      "-a",
      "+A",
      " b",
      "@@ -50,2 +50,2 @@ tail",
      " y",
      "-z",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.hunks.length, 2);
  assert.deepEqual(
    parsed.hunks[1].rows.map((r) => [r.oldNo, r.newNo]),
    [
      [50, 50],
      [51, null],
    ],
  );
  assert.equal(parsed.hunks[1].heading, "tail");
});

test("hunkSides reconstructs each side, with context on both", () => {
  const parsed = parseUnifiedDiff(MODIFY);
  assert.ok(parsed);
  const { oldText, newText } = hunkSides(parsed.hunks[0].rows);
  assert.equal(oldText.split("\n").length, 5); // 4 context + 1 deletion
  assert.equal(newText.split("\n").length, 6); // 4 context + 2 additions
  assert.ok(oldText.includes('return "ok";'));
  assert.ok(!oldText.includes('return "success";'));
  assert.ok(newText.includes("// renamed for the badge"));
});

const row = (kind: DiffRow["kind"], text: string): DiffRow => ({
  kind,
  text,
  oldNo: kind === "add" ? null : 1,
  newNo: kind === "del" ? null : 1,
  noNewline: false,
});

test("pairRows zips a deletion run against the addition run that follows it", () => {
  const paired = pairRows([
    row("ctx", "keep"),
    row("del", "one"),
    row("del", "two"),
    row("add", "ONE"),
    row("ctx", "end"),
  ]);
  assert.deepEqual(
    paired.map((p) => [p.left?.text ?? null, p.right?.text ?? null]),
    [
      ["keep", "keep"],
      ["one", "ONE"],
      ["two", null], // no addition opposite it — a blank, not a shifted row
      ["end", "end"],
    ],
  );
});

test("pairRows keeps a pure addition on the right and a pure deletion on the left", () => {
  assert.deepEqual(
    pairRows([row("add", "new")]).map((p) => [p.left, p.right?.text]),
    [[null, "new"]],
  );
  assert.deepEqual(
    pairRows([row("del", "gone")]).map((p) => [p.left?.text, p.right]),
    [["gone", null]],
  );
});

test("every row survives the pairing — the split view can't drop a line", () => {
  const parsed = parseUnifiedDiff(MODIFY);
  assert.ok(parsed);
  const rows = parsed.hunks[0].rows;
  const paired = pairRows(rows);
  const seen = new Set<DiffRow>();
  for (const { left, right } of paired) {
    if (left) seen.add(left);
    if (right) seen.add(right);
  }
  assert.equal(seen.size, rows.length);
});
