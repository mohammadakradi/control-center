"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Full-screen dialog shell: proper `dialog` semantics, Escape to close, a focus
 * trap, focus restored to the trigger on close, and a locked body scroll.
 * Use this instead of hand-rolling an overlay + panel.
 */
export function Modal({
  /** Accessible name for the dialog (usually the file path or a short title). */
  label,
  /** Visible header content, rendered on the left of the title bar. */
  header,
  /** Optional buttons rendered next to the close button. */
  actions,
  onClose,
  /** Width cap for the panel, e.g. `max-w-3xl`. */
  className = "max-w-3xl",
  children,
}: {
  label: string;
  header?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Callers pass an inline closure, so `onClose` is a new function every render.
  // Keying the setup effect on it would tear down the trap and re-steal focus on
  // every parent re-render (e.g. each SSE token while a task streams), which also
  // corrupts `previouslyFocused`. Read it through a ref and run setup once.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Skip hidden controls. Note `offsetParent` is also null for `position: fixed`
      // elements — no modal content uses one today, but a future one would need a
      // different visibility test.
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
    // Mount/unmount only — see the `onCloseRef` note above.
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm"
      onClick={() => onCloseRef.current()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl outline-none ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <span id={titleId} className="min-w-0 flex-1 truncate">
            {header ?? label}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-lg p-1 text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg-strong"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
