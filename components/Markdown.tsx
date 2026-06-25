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
function normalizeMarkdown(md: string): string {
  let inFence = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : line.replace(BULLET_LINE, "$1- ");
    })
    .join("\n");
}

// Test-scenario files the agent writes (e.g. `.swe/test-scenarios/foo.md`).
// These render as inline code in reports; we make them clickable to open in a modal.
const isTestScenarioPath = (text: string) =>
  !/\s/.test(text) && /(^|\/)test-scenarios\/[^/]+\.(md|markdown)$/.test(text);

// Styling is applied via descendant variants so we don't need per-element
// component overrides (which would each receive an unused `node` prop).
const MD = [
  "text-sm text-neutral-200 break-words",
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-neutral-100",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-neutral-100",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-neutral-200",
  "[&_p]:my-1.5 [&_p]:leading-relaxed",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5 [&_li]:leading-relaxed [&_li]:marker:text-neutral-600",
  "[&_strong]:font-semibold [&_strong]:text-neutral-100 [&_em]:italic",
  "[&_a]:text-sky-400 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-sky-300",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-700 [&_blockquote]:pl-3 [&_blockquote]:text-neutral-400",
  "[&_hr]:my-3 [&_hr]:border-neutral-800",
  "[&_code]:rounded [&_code]:bg-neutral-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-sky-200",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-neutral-950/70 [&_pre]:p-3 [&_pre]:text-xs",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-neutral-300",
  "[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-xs",
  "[&_th]:border [&_th]:border-neutral-800 [&_th]:bg-neutral-900 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:border-neutral-800 [&_td]:px-2 [&_td]:py-1",
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
          if (isTestScenarioPath(text)) {
            return (
              <code
                {...rest}
                role="button"
                tabIndex={0}
                onClick={() => onFileClick(text)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onFileClick(text);
                }}
                className="cursor-pointer underline decoration-dotted underline-offset-2 hover:!text-sky-300"
                title="View test scenario"
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
