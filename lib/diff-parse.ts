/**
 * Turning a unified diff into rows the viewer can render.
 *
 * The input is whatever `GET /api/projects/:id/diff` returned, and **not every diff here came
 * out of `git diff`** — `untrackedDiff` in `lib/git.ts` synthesizes one for an untracked file,
 * a mode-only change arrives with no hunks at all, binary files arrive as a single sentence in
 * two different wordings, and anything past `DIFF_CAP` (200 KB) is cut mid-hunk with a
 * `… (diff truncated)` line bolted on. So this parser is written to be told nothing and still
 * answer: it returns `null` when it recognises no structure, and the viewer then falls back to
 * colouring lines by their prefix, which is what the whole modal used to do.
 *
 * Pure — no DOM, no `node:*`. `lib/diff-parse.test.ts` covers every shape listed above.
 */

export type DiffRowKind = "ctx" | "add" | "del";

export type DiffRow = {
  kind: DiffRowKind;
  /** The line's content, with git's leading `+`/`-`/space marker removed. */
  text: string;
  /** 1-based line number on the "before" side, or null for an addition. */
  oldNo: number | null;
  /** 1-based line number on the "after" side, or null for a deletion. */
  newNo: number | null;
  /** git's `\ No newline at end of file` applied to this line. */
  noNewline: boolean;
};

export type DiffHunk = {
  /** The raw `@@ -a,b +c,d @@` range, without the section heading. */
  range: string;
  /** What git prints after the second `@@` — usually the enclosing function. */
  heading: string;
  rows: DiffRow[];
};

export type ParsedDiff = {
  /** Everything before the first hunk: `diff --git`, `index`, mode lines, `---`/`+++`. */
  headerLines: string[];
  hunks: DiffHunk[];
  /** git refused to render content because the file is binary. */
  binary: boolean;
  /** Present when the diff carries `old mode` / `new mode` lines. */
  modeChange: { from: string; to: string } | null;
  fileState: "new" | "deleted" | "modified";
  /** The server cut the diff at its size cap, so the last hunk may be incomplete. */
  truncated: boolean;
};

/** What `lib/git.ts` appends when a diff exceeds `DIFF_CAP`. */
const TRUNCATION_MARKER = "… (diff truncated)";

/** `@@ -a,b +c,d @@ heading` — both counts are optional, because git omits `,1`. */
const HUNK_RE = /^(@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@)(?: ?(.*))?$/;

/**
 * Parse a unified diff, or return `null` if there is nothing here we understand — an empty
 * string, or a body with no hunk, no `diff --git`/`---`/`+++` header and no binary notice.
 * A `null` is the signal to render the raw text instead; it is never an error.
 */
export function parseUnifiedDiff(diff: string): ParsedDiff | null {
  const headerLines: string[] = [];
  const hunks: DiffHunk[] = [];
  let binary = false;
  let modeChange: { from: string; to: string } | null = null;
  let fileState: ParsedDiff["fileState"] = "modified";
  let truncated = false;

  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let sawHeader = false;

  for (const line of diff.split("\n")) {
    if (line === TRUNCATION_MARKER) {
      truncated = true;
      break;
    }

    const match = HUNK_RE.exec(line);
    if (match) {
      hunk = { range: match[1], heading: (match[6] ?? "").trim(), rows: [] };
      hunks.push(hunk);
      oldNo = Number(match[2]);
      newNo = Number(match[4]);
      continue;
    }

    if (hunk) {
      // `\ No newline at end of file` describes the row above it rather than being one.
      if (line.startsWith("\\")) {
        const last = hunk.rows[hunk.rows.length - 1];
        if (last) last.noNewline = true;
        continue;
      }
      const marker = line[0];
      if (marker === "+" || marker === "-" || marker === " " || line === "") {
        const kind: DiffRowKind =
          marker === "+" ? "add" : marker === "-" ? "del" : "ctx";
        hunk.rows.push({
          kind,
          // An empty line is a context line git wrote as a bare " " and something along the
          // way trimmed; treating it as content keeps the two sides' line counts honest.
          text: line === "" ? "" : line.slice(1),
          oldNo: kind === "add" ? null : oldNo++,
          newNo: kind === "del" ? null : newNo++,
          noNewline: false,
        });
        continue;
      }
      // Anything else ends the hunk — a second `diff --git` in a combined diff, or trailing
      // prose. Fall through and treat it as header material.
      hunk = null;
    }

    if (line === "") continue;
    if (line.startsWith("Binary file")) binary = true;
    if (line.startsWith("new file mode")) fileState = "new";
    if (line.startsWith("deleted file mode")) fileState = "deleted";
    if (line.startsWith("old mode ")) {
      modeChange = { from: line.slice("old mode ".length).trim(), to: "" };
    }
    if (line.startsWith("new mode ") && modeChange) {
      modeChange.to = line.slice("new mode ".length).trim();
    }
    if (
      line.startsWith("diff ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line === "--- /dev/null" ||
      line === "+++ /dev/null"
    ) {
      sawHeader = true;
    }
    headerLines.push(line);
  }

  if (hunks.length === 0 && !binary && !sawHeader) return null;

  return { headerLines, hunks, binary, modeChange, fileState, truncated };
}

/**
 * The two sides of a hunk as plain text, for handing to the highlighter.
 *
 * Highlighting per *line* would restart the grammar on every row, so a line inside a block
 * comment or a template literal would be coloured as if it were code. A hunk is the largest
 * unit a diff actually gives us, so each side is highlighted whole and split back into rows.
 * Context lines belong to both sides.
 */
export function hunkSides(rows: DiffRow[]): { oldText: string; newText: string } {
  const old: string[] = [];
  const next: string[] = [];
  for (const row of rows) {
    if (row.kind !== "add") old.push(row.text);
    if (row.kind !== "del") next.push(row.text);
  }
  return { oldText: old.join("\n"), newText: next.join("\n") };
}

export type SplitRow = { left: DiffRow | null; right: DiffRow | null };

/**
 * Pair a hunk's rows into side-by-side rows.
 *
 * A run of deletions immediately followed by a run of additions is one edit, so the two runs
 * are zipped index-wise and whichever is longer leaves blanks opposite it. Context lines sit
 * on both sides. This is the standard pairing and it is intentionally *not* a diff algorithm:
 * it re-groups rows git already computed, so it can never disagree with the unified view.
 */
export function pairRows(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: DiffRow[] = [];
  let adds: DiffRow[] = [];

  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      out.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    }
    dels = [];
    adds = [];
  };

  for (const row of rows) {
    if (row.kind === "del") dels.push(row);
    else if (row.kind === "add") adds.push(row);
    else {
      flush();
      out.push({ left: row, right: row });
    }
  }
  flush();
  return out;
}

/**
 * A sentence for a diff that has no rows to show, or `null` when the hunks speak for
 * themselves. Without this, `chmod +x` and a binary file both rendered as a blank panel under
 * a couple of header lines, which reads as "the viewer is broken" rather than "there is no
 * text to show".
 */
export function diffNotice(diff: ParsedDiff): string | null {
  if (diff.binary) return "Binary file — there is no text diff to show.";
  if (diff.hunks.length > 0) return null;
  if (diff.modeChange) {
    return `File mode changed from ${diff.modeChange.from} to ${diff.modeChange.to}. The contents are unchanged.`;
  }
  // `untrackedDiff` emits the header and stops when the file is empty, so there is no hunk and
  // no mode line to explain the blank panel either. Same on the way out for a deleted one.
  if (diff.fileState === "new") return "New file — it is empty.";
  if (diff.fileState === "deleted") return "This file was deleted. It was empty.";
  return null;
}

/** Total rows across every hunk — the viewer's cue for how much work rendering will be. */
export function countRows(diff: ParsedDiff): number {
  return diff.hunks.reduce((n, h) => n + h.rows.length, 0);
}
