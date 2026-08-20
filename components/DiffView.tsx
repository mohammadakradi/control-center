"use client";

import { useMemo } from "react";
import { languageForPath } from "@/lib/code-lang";
import {
  countRows,
  diffNotice,
  hunkSides,
  pairRows,
  parseUnifiedDiff,
  type DiffRow,
  type DiffRowKind,
} from "@/lib/diff-parse";
import { CodeTokens, GUTTER, useHighlightedLines } from "@/components/CodeView";
import type { CodeLine } from "@/lib/highlight";

export type DiffViewMode = "unified" | "split";

/** Past this the rows render plain (no highlighting), but stay rows. */
const HIGHLIGHT_MAX_ROWS = 3_000;

/**
 * Past this we stop emitting rows at all and show the diff as one `<pre>`.
 *
 * `DIFF_CAP` in `lib/git.ts` bounds a diff to 200 000 **characters, not lines** — so a file of
 * many short lines (`+x`) fits inside it while producing tens of thousands of rows, and
 * `truncated` never fires. Each row here is five elements deep, doubled again in split view,
 * so that is hundreds of thousands of DOM nodes built synchronously: the tab freezes. The
 * generated/data files this hits are exactly the kind an agent writes and a reviewer then
 * opens. Same guard, same number, as `ROWS_MAX_LINES` in `CodeView` — nothing is truncated,
 * only the presentation drops back.
 */
const ROWS_MAX = 5_000;

const ROW_BG: Record<DiffRowKind, string> = {
  add: "bg-ok-soft",
  del: "bg-danger-soft",
  ctx: "",
};

/** The sign is the *non-colour* signal that a line was added or removed, so it is real text
 *  in the markup rather than a background and a border. It is `select-none` so copying a
 *  block of code out of the viewer gives you the code and not a column of markers. */
const SIGN: Record<DiffRowKind, string> = { add: "+", del: "−", ctx: " " };
const SIGN_TONE: Record<DiffRowKind, string> = {
  add: "text-ok",
  del: "text-danger",
  // A context row's "sign" is a space — there is no glyph to colour, so it gets no colour
  // class. Deliberately not `text-fg-ghost`: a grep for that token is supposed to return
  // icons and markers only, and a hit here would cost the next auditor a second look.
  ctx: "",
};

const CODE_CELL = "min-w-0 flex-1 whitespace-pre-wrap break-words pr-2";

/** The viewer as it was before this file existed: every line coloured by its first character.
 *  Still the answer for anything `parseUnifiedDiff` doesn't recognise, which is the point of
 *  keeping it — the diff endpoint can return text no version of git ever wrote. */
function RawDiff({ diff }: { diff: string }) {
  return (
    <pre className="font-mono text-xs leading-relaxed">
      {diff.split("\n").map((line, i) => {
        let cls = "text-fg-subtle";
        if (line.startsWith("+") && !line.startsWith("+++"))
          cls = "bg-ok-soft text-ok";
        else if (line.startsWith("-") && !line.startsWith("---"))
          cls = "bg-danger-soft text-danger";
        else if (line.startsWith("@@")) cls = "text-accent";
        else if (
          line.startsWith("diff ") ||
          line.startsWith("index ") ||
          line.startsWith("+++") ||
          line.startsWith("---") ||
          line.startsWith("new file") ||
          line.startsWith("deleted file")
        )
          cls = "text-fg-faint";
        return (
          <div key={i} className={`whitespace-pre-wrap px-2 ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function Sign({ kind }: { kind: DiffRowKind }) {
  return (
    <span
      className={`w-4 shrink-0 select-none text-center ${SIGN_TONE[kind]}`}
    >
      {SIGN[kind]}
    </span>
  );
}

function UnifiedRow({
  row,
  tokens,
}: {
  row: DiffRow;
  tokens: CodeLine | undefined;
}) {
  return (
    <div className={`flex ${ROW_BG[row.kind]}`}>
      <span aria-hidden="true" className={GUTTER}>
        {row.oldNo ?? ""}
      </span>
      <span aria-hidden="true" className={GUTTER}>
        {row.newNo ?? ""}
      </span>
      <Sign kind={row.kind} />
      <code className={CODE_CELL}>
        <CodeTokens tokens={tokens} text={row.text} />
      </code>
    </div>
  );
}

function SplitSide({
  row,
  tokens,
  side,
  className = "",
}: {
  row: DiffRow | null;
  tokens: CodeLine | undefined;
  side: "old" | "new";
  className?: string;
}) {
  // A half with no line opposite it gets the faint row wash rather than a third tone: it isn't
  // a change, it's the absence of one, and every tone in this app already means something.
  const bg = row ? ROW_BG[row.kind] : "bg-hover";
  return (
    <div className={`flex w-1/2 min-w-0 ${bg} ${className}`}>
      <span aria-hidden="true" className={GUTTER}>
        {(side === "old" ? row?.oldNo : row?.newNo) ?? ""}
      </span>
      {row ? <Sign kind={row.kind} /> : <span className="w-4 shrink-0" />}
      <code className={CODE_CELL}>
        {row ? <CodeTokens tokens={tokens} text={row.text} /> : ""}
      </code>
    </div>
  );
}

/**
 * A unified diff, rendered as rows.
 *
 * Both views are built from the **same parsed rows** — the split view re-groups what git
 * already computed rather than diffing anything itself, so the two can never disagree about
 * what changed. Highlighting is per *side* rather than per line: each side of every hunk is
 * concatenated and highlighted as one document, so a line inside a block comment stays a
 * comment instead of being re-lexed as code (see `hunkSides`).
 */
export function DiffView({
  diff,
  path,
  view,
}: {
  diff: string;
  path: string;
  view: DiffViewMode;
}) {
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff]);

  const sides = useMemo(() => {
    const oldChunks: string[] = [];
    const newChunks: string[] = [];
    for (const hunk of parsed?.hunks ?? []) {
      const { oldText, newText } = hunkSides(hunk.rows);
      // A hunk with nothing on one side contributes no lines to it. Pushing "" would add a
      // phantom blank line and shift every hunk after it by one — a new file, whose only
      // hunk has no old side at all, is the common case.
      if (hunk.rows.some((r) => r.kind !== "add")) oldChunks.push(oldText);
      if (hunk.rows.some((r) => r.kind !== "del")) newChunks.push(newText);
    }
    return { oldText: oldChunks.join("\n"), newText: newChunks.join("\n") };
  }, [parsed]);

  const language = useMemo(() => languageForPath(path), [path]);
  const highlightable =
    parsed && countRows(parsed) <= HIGHLIGHT_MAX_ROWS ? language : null;
  const oldLines = useHighlightedLines(sides.oldText, highlightable);
  const newLines = useHighlightedLines(sides.newText, highlightable);

  /** Row → its tokens. Keyed by the row object, so the unified and split views read the same
   *  map and a row can't pick up the colours of the line above it in one view only. */
  const tokens = useMemo(() => {
    const map = new Map<DiffRow, CodeLine>();
    let o = 0;
    let n = 0;
    for (const hunk of parsed?.hunks ?? []) {
      for (const row of hunk.rows) {
        if (row.kind !== "add") {
          if (row.kind === "del" && oldLines?.[o]) map.set(row, oldLines[o]);
          o++;
        }
        if (row.kind !== "del") {
          if (newLines?.[n]) map.set(row, newLines[n]);
          n++;
        }
      }
    }
    return map;
  }, [parsed, oldLines, newLines]);

  if (!parsed) return <RawDiff diff={diff} />;

  const rowCount = countRows(parsed);
  if (rowCount > ROWS_MAX) {
    return (
      <div className="space-y-2">
        <p className="px-2 text-xs text-fg-faint">
          {`This diff has ${rowCount.toLocaleString("en-US")} lines — showing it as plain text, without highlighting, line numbers or the side-by-side view. Nothing is left out.`}
        </p>
        <pre className="whitespace-pre-wrap break-words px-2 font-mono text-xs leading-relaxed text-fg">
          {diff}
        </pre>
      </div>
    );
  }

  const notice = diffNotice(parsed);

  return (
    <div className="font-mono text-xs leading-relaxed text-fg">
      {parsed.headerLines.length > 0 && (
        <div className="px-2 pb-1 text-[11px] text-fg-faint">
          {parsed.headerLines.map((line, i) => (
            <div key={i} className="truncate">
              {line}
            </div>
          ))}
        </div>
      )}

      {notice && (
        <p className="px-2 py-3 font-sans text-sm text-fg-faint">{notice}</p>
      )}

      {/* Two readable columns need more than a phone has, so below ~700px the split view
          scrolls sideways inside the modal rather than crushing both sides. `min-w-176` is
          44rem off Tailwind v4's spacing scale, not an arbitrary value. */}
      <div className={view === "split" ? "min-w-176" : undefined}>
        {parsed.hunks.map((hunk, h) => (
          <div key={h}>
            <div className="flex gap-2 border-y border-line bg-surface-2 px-2 py-1 text-[11px]">
              <span className="shrink-0 text-accent">{hunk.range}</span>
              {hunk.heading && (
                <span className="min-w-0 truncate text-fg-faint">
                  {hunk.heading}
                </span>
              )}
            </div>
            {view === "unified"
              ? hunk.rows.map((row, i) => (
                  <UnifiedRow key={i} row={row} tokens={tokens.get(row)} />
                ))
              : pairRows(hunk.rows).map(({ left, right }, i) => (
                  <div key={i} className="flex">
                    <SplitSide
                      row={left}
                      tokens={left ? tokens.get(left) : undefined}
                      side="old"
                    />
                    <SplitSide
                      row={right}
                      tokens={right ? tokens.get(right) : undefined}
                      side="new"
                      className="border-l border-line"
                    />
                  </div>
                ))}
          </div>
        ))}
      </div>

      {parsed.truncated && (
        <p className="border-t border-line px-2 py-2 font-sans text-xs text-warn">
          This diff was cut off at 200 KB — the rest of the file&rsquo;s changes
          aren&rsquo;t shown here.
        </p>
      )}
    </div>
  );
}
