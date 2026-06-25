"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Markdown } from "./Markdown";

const PREVIEW_LEN = 160;

/** Task request text: a short preview by default, expandable to the full
 *  (markdown-formatted) content — handy for long seeded reports. */
export function ExpandableRequest({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > PREVIEW_LEN;
  const preview = text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LEN);

  if (!long) {
    return <p className="mt-1.5 max-w-3xl text-neutral-300">{text}</p>;
  }

  return (
    <div className="mt-1.5 max-w-3xl">
      {open ? (
        <div className="max-h-80 overflow-auto rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
          <Markdown>{text}</Markdown>
        </div>
      ) : (
        <p className="text-neutral-300">{preview}…</p>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-1.5 inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
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
