/**
 * Unit tests for the highlighter's line/token output.
 *
 * The invariant these exist for: **re-joining the tokens must reproduce the input exactly.**
 * The viewers render nothing but these tokens, so a flattening bug doesn't look like a bug —
 * it silently drops or duplicates a character in the middle of someone's code review, and the
 * only thing on screen is a line that reads plausibly and is wrong. Every case below asserts
 * the round trip before it asserts anything about colour.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { highlightLines, plainLines, type CodeLine } from "./highlight";

const rejoin = (lines: CodeLine[]) =>
  lines.map((l) => l.map((t) => t.text).join("")).join("\n");

const classesIn = (lines: CodeLine[]) =>
  new Set(lines.flatMap((l) => l.map((t) => t.cls)).filter(Boolean));

test("highlighting preserves the source byte-for-byte", () => {
  const code = [
    "// leading comment",
    "export function greet(name: string) {",
    '  const msg = `hello ${name}`;   // trailing',
    "",
    "  return msg;",
    "}",
  ].join("\n");
  assert.equal(rejoin(highlightLines(code, "typescript")), code);
});

test("indentation and blank lines survive — a diff row is nothing without them", () => {
  const code = "a\n\n    indented\n\t\ttabbed\n";
  const lines = highlightLines(code, "typescript");
  assert.equal(rejoin(lines), code);
  // A trailing newline is a final empty line, so the row count matches the source's.
  assert.equal(lines.length, 5);
  assert.deepEqual(lines[1], []);
});

test("a multi-line construct is coloured as one thing, which per-line highlighting can't do", () => {
  // This is the reason `hunkSides` reconstructs whole sides instead of highlighting each row:
  // line 2 is prose inside a block comment, and on its own it lexes as code.
  const code = ["/*", " * const notReallyCode = 1;", " */", "const real = 1;"].join(
    "\n",
  );
  const lines = highlightLines(code, "typescript");
  assert.equal(rejoin(lines), code);
  assert.ok(
    lines[1].every((t) => t.cls.includes("comment")),
    "the middle of a block comment must still be a comment",
  );
});

test("classes actually come through, and the innermost one wins", () => {
  const lines = highlightLines('const s = "hi";', "typescript");
  const classes = classesIn(lines);
  assert.ok([...classes].some((c) => c.includes("keyword")));
  assert.ok([...classes].some((c) => c.includes("string")));
  // No token may carry two nested `hljs-*` scopes joined together: two rules of equal
  // specificity would leave the colour to whichever the stylesheet emitted last.
  for (const cls of classes) {
    assert.ok(
      cls.split(" ").filter((c) => c.startsWith("hljs-")).length <= 1,
      `token class "${cls}" stacks two hljs scopes`,
    );
  }
});

test("nested scopes keep their own colour and still round-trip", () => {
  // A template literal with an interpolation is a `hljs-subst` nested inside a `hljs-string`.
  const code = "const t = `a ${b} c`;";
  const lines = highlightLines(code, "typescript");
  assert.equal(rejoin(lines), code);
  const strings = lines[0].filter((t) => t.cls.includes("string"));
  assert.ok(strings.length > 0);
  assert.ok(strings.every((t) => !t.text.includes("${b}")));
});

test("an empty file is one empty line, not zero lines", () => {
  assert.deepEqual(highlightLines("", "typescript"), [[]]);
  assert.deepEqual(plainLines(""), [[]]);
});

test("plainLines matches the highlighted shape, so the fallback renders identically", () => {
  const code = "one\n\nthree";
  const plain = plainLines(code);
  assert.equal(rejoin(plain), code);
  assert.equal(plain.length, highlightLines(code, "markdown").length);
  assert.ok(plain.every((line) => line.every((t) => t.cls === "")));
});

test("several grammars round-trip, including ones with unusual lexing", () => {
  const samples: [string, string][] = [
    ["bash", '#!/bin/sh\nset -eu\necho "hi $HOME"\n'],
    ["json", '{\n  "a": [1, 2],\n  "b": null\n}'],
    ["css", ".a {\n  color: var(--fg);\n}"],
    ["yaml", "services:\n  web:\n    image: node:22\n"],
    ["python", 'def f(x):\n    """doc"""\n    return x  # done'],
    ["diff", "@@ -1 +1 @@\n-a\n+b"],
    ["xml", '<div class="x">\n  <span>hi</span>\n</div>'],
  ];
  for (const [language, code] of samples) {
    assert.equal(
      rejoin(highlightLines(code, language as never)),
      code,
      language,
    );
  }
});

test("an unregistered grammar degrades to plain text instead of throwing", () => {
  // The viewers call this from a render path; an exception here would blank the modal.
  const code = "whatever\nthis is";
  const lines = highlightLines(code, "klingon" as never);
  assert.equal(rejoin(lines), code);
  assert.equal(classesIn(lines).size, 0);
});
