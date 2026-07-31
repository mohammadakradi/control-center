"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/** A read-only command in a mono field with a copy button. Used for setup commands
 *  the user has to run in their own terminal. */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the "copied" flash on unmount so it can't fire after the field is gone.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context / denied) — the text is selectable anyway */
    }
  }

  return (
    <div className="flex items-stretch gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-xs whitespace-nowrap text-fg-strong">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={label ? `Copy ${label}` : "Copy to clipboard"}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg-strong"
      >
        {copied ? (
          <>
            <Check className="size-3.5 text-ok" aria-hidden="true" /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3.5" aria-hidden="true" /> Copy
          </>
        )}
      </button>
    </div>
  );
}
