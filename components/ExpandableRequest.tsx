"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Markdown } from "./Markdown";

const PREVIEW_LEN = 160;

/** Task request text: a short preview by default, expandable to the full
 *  (markdown-formatted) content — handy for long seeded reports. */
export function ExpandableRequest({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const long = text.length > PREVIEW_LEN;
  const preview = text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LEN);

  if (!long) {
    return <p className="mt-1.5 max-w-3xl text-fg-muted">{text}</p>;
  }

  return (
    <div className="mt-1.5 max-w-3xl">
      {open ? (
        <div
          id={regionId}
          className="scroll-thin max-h-80 overflow-auto rounded-lg border border-line bg-surface p-3"
        >
          <Markdown>{text}</Markdown>
        </div>
      ) : (
        <p id={regionId} className="text-fg-muted">
          {preview}…
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={regionId}
        className="mt-1.5 inline-flex items-center gap-1 rounded text-xs text-accent hover:text-accent-hover"
      >
        {open ? (
          <>
            <ChevronUp className="size-3.5" /> Show less
          </>
        ) : (
          <>
            <ChevronDown className="size-3.5" /> Show more
          </>
        )}
      </button>
    </div>
  );
}
