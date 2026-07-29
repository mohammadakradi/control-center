import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

// The agent writes loose markdown: one thought per line, and "bullets" typed as
// glyphs (• ● ◦ …) that CommonMark doesn't recognise as list markers. Promote
// those to real `-` list items so they render as a proper list (remark-breaks
// then keeps every other single newline as a visible line break). Em/en dashes
// are left alone — the agent uses "—" as an inline separator ("H1 — Redact …").
const BULLET_LINE = /^(\s*)[•●◦▪▸‣∙·]\s+/;

// Agents also enumerate inline — "Plan: (1) … (2) … (3) …" — as one run-on
// paragraph with no list syntax. When a line carries a real sequence (starts at
// (1) and runs 1,2,3,… with 3+ items) break each marker onto its own numbered
// line. Gated tightly so incidental references ("(1) and (2)") are left alone.
function splitInlineEnumeration(line: string): string {
  const nums = [...line.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));
  const isSequence =
    nums.length >= 3 && nums.every((n, i) => n === i + 1);
  return isSequence
    ? line.replace(/\s*\((\d+)\)\s*/g, (_, n) => `\n${n}. `)
    : line;
}

function normalizeMarkdown(md: string): string {
  let inFence = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return splitInlineEnumeration(line.replace(BULLET_LINE, "$1- "));
    })
    .join("\n");
}

// File paths the agent writes that we make clickable inline (rendered as code in reports),
// opening in a modal: swe/fe test scenarios, and pm task specs (.pm/tasks/<ts>/<task>.md).
const isTestScenarioPath = (text: string) =>
  !/\s/.test(text) && /(^|\/)test-scenarios\/[^/]+\.(md|markdown)$/.test(text);
const isPmTaskPath = (text: string) =>
  !/\s/.test(text) && /(^|\/)\.pm\/tasks\/[^/]+\/[^/]+\.(md|markdown)$/.test(text);
const isClickablePath = (text: string) =>
  isTestScenarioPath(text) || isPmTaskPath(text);

// Styling is applied via descendant variants so we don't need per-element
// component overrides (which would each receive an unused `node` prop).
const MD = [
  "text-sm text-fg break-words",
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-fg-strong",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-fg-strong",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-fg-strong",
  "[&_p]:my-1.5 [&_p]:leading-relaxed",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5 [&_li]:leading-relaxed [&_li]:marker:text-fg-ghost",
  "[&_strong]:font-semibold [&_strong]:text-fg-strong [&_em]:italic",
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-accent-hover",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-subtle",
  "[&_hr]:my-3 [&_hr]:border-line",
  "[&_code]:rounded [&_code]:bg-surface-3 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-accent",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-sunken [&_pre]:p-3 [&_pre]:text-xs",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-fg-muted",
  "[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-xs",
  "[&_th]:border [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
].join(" ");

/** Render trusted agent markdown (reports, proposals) as formatted text.
 *  When `onFileClick` is provided, inline references to test-scenario files
 *  become clickable and call back with the file path. */
export function Markdown({
  children,
  onFileClick,
}: {
  children: string;
  onFileClick?: (path: string) => void;
}) {
  const components = onFileClick
    ? {
        code(props: ComponentProps<"code">) {
          const { children: kids, ...rest } = props;
          const text = String(kids);
          if (isClickablePath(text)) {
            return (
              <code
                {...rest}
                role="button"
                tabIndex={0}
                onClick={() => onFileClick(text)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onFileClick(text);
                }}
                className="cursor-pointer underline decoration-dotted underline-offset-2 hover:!text-accent-hover"
                title={isPmTaskPath(text) ? "Open task" : "View test scenario"}
              >
                {kids}
              </code>
            );
          }
          return <code {...rest}>{kids}</code>;
        },
      }
    : undefined;

  return (
    <div className={MD}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {normalizeMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}
