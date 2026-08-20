"use client";

import { useEffect, useMemo, useState } from "react";
import { languageForPath, type CodeLanguage } from "@/lib/code-lang";
// `import type` is load-bearing: it is erased at build time, so naming the highlighter here
// does not pull its ~200 KB of grammars into this component's bundle. The only real reference
// to that module is the `import()` below.
import type { CodeLine } from "@/lib/highlight";

/**
 * Above this the highlighter is skipped and the text renders plain.
 *
 * A diff is capped at 200 KB by `DIFF_CAP`, but a *file* comes through a 512 KB route, and
 * highlighting is synchronous work on the main thread — a minified bundle opened by accident
 * should not freeze the tab. The number is a budget, not a measurement of the grammar.
 */
export const HIGHLIGHT_MAX_BYTES = 200_000;

/** Above this we stop rendering one element per line and fall back to a single `<pre>`: the
 *  gutter and per-line rows are what make a 20 000-line file expensive, not the characters. */
const ROWS_MAX_LINES = 5_000;

type HighlightModule = typeof import("@/lib/highlight");

let pending: Promise<HighlightModule> | null = null;

/**
 * One in-flight import shared by every viewer, so opening a second file is instant.
 *
 * A rejection clears the cache. Holding on to a failed promise would mean one transient chunk
 * failure — a 404 after an update swapped `app/`, a dropped connection — turned every file and
 * diff opened for the rest of that tab's life into plain text, with no way back short of a
 * reload. Retrying on the next open costs nothing when the module is already there.
 */
function loadHighlighter(): Promise<HighlightModule> {
  if (!pending) {
    pending = import("@/lib/highlight").catch((e) => {
      pending = null;
      throw e;
    });
  }
  return pending;
}

/**
 * Tokenised lines for `code`, or `null` while the highlighter is still loading, when there is
 * no grammar for the file, or when the content is over budget. `null` is a render instruction,
 * not an error: callers show the plain text, which is also what they show for the first frame.
 *
 * The result is stored **with the inputs that produced it**, and the comparison happens at
 * render. Keeping only the tokens would leave the previous file's colours painted onto the new
 * file's lines for one frame every time you press Next — the rows would be off by whatever the
 * two files disagree about. Resetting in an effect is not an option here (`setState` inside an
 * effect body is a hard error in this build), and this is the cheaper answer anyway.
 */
export function useHighlightedLines(
  code: string,
  language: CodeLanguage | null,
): CodeLine[] | null {
  const enabled = language !== null && code.length <= HIGHLIGHT_MAX_BYTES;
  const [done, setDone] = useState<{
    code: string;
    language: CodeLanguage;
    lines: CodeLine[];
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadHighlighter()
      .then(({ highlightLines }) => {
        if (!cancelled) {
          setDone({ code, language, lines: highlightLines(code, language) });
        }
      })
      .catch(() => {
        /* the chunk failed to load — plain text is a perfectly good viewer */
      });
    return () => {
      cancelled = true;
    };
  }, [code, language, enabled]);

  if (!enabled || !done) return null;
  return done.code === code && done.language === language ? done.lines : null;
}

/** One line of code: its tokens if we have them, otherwise its raw text. */
export function CodeTokens({
  tokens,
  text,
}: {
  tokens: CodeLine | undefined;
  text: string;
}) {
  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={token.cls || undefined}>
          {token.text}
        </span>
      ))}
    </>
  );
}

/** Shared gutter treatment. `aria-hidden` because a screen reader announcing a number before
 *  every line is noise — but `fg-faint`, not `fg-ghost`, because a sighted user reads these. */
export const GUTTER =
  "w-11 shrink-0 select-none pr-2 text-right text-[11px] leading-relaxed tabular-nums text-fg-faint";

/** Split a file into the lines a viewer renders: one trailing newline is the end of the last
 *  line rather than an empty line after it, and rendering it as a row is just a stray number. */
export function codeLines(code: string): string[] {
  return code.replace(/\n$/, "").split("\n");
}

/**
 * A read-only file view: syntax-highlighted, line-numbered, wrapping.
 *
 * Used by `FileModal` for anything that isn't markdown. It renders the plain text first and
 * swaps in colour when the highlighter chunk has loaded — a progressive enhancement, so a slow
 * or failed chunk load costs legibility and nothing else.
 */
export function CodeView({ code, path }: { code: string; path: string }) {
  const language = useMemo(() => languageForPath(path), [path]);
  const body = useMemo(() => code.replace(/\n$/, ""), [code]);
  const lines = useMemo(() => body.split("\n"), [body]);
  const oversized = lines.length > ROWS_MAX_LINES;

  const tokens = useHighlightedLines(body, oversized ? null : language);
  // A mismatch can only mean a bug, but rendering row N of one against row N of the other
  // would be a *plausible-looking* wrong file, so fall back rather than trust it.
  const highlighted = tokens?.length === lines.length ? tokens : null;

  if (oversized) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-fg-faint">
          {`This file has ${lines.length.toLocaleString("en-US")} lines — showing it as plain text, without line numbers or highlighting.`}
        </p>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg">
          {body}
        </pre>
      </div>
    );
  }

  return (
    <div className="font-mono text-xs leading-relaxed text-fg">
      {language && code.length > HIGHLIGHT_MAX_BYTES && (
        <p className="mb-2 font-sans text-xs text-fg-faint">
          Syntax highlighting is off — this file is larger than{" "}
          {HIGHLIGHT_MAX_BYTES / 1000} KB.
        </p>
      )}
      {lines.map((text, i) => (
        <div key={i} className="flex">
          <span aria-hidden="true" className={GUTTER}>
            {i + 1}
          </span>
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            <CodeTokens tokens={highlighted?.[i]} text={text} />
          </code>
        </div>
      ))}
    </div>
  );
}
