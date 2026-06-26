"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  /** Optional secondary line shown under the label (also searched). */
  description?: string;
  /** Optional leading icon node. */
  icon?: ReactNode;
};

/**
 * Shared, bespoke select / combobox.
 *
 * A native `<select>` can't be filtered, so this is a custom popover: trigger
 * button + (optional) search field + keyboard-navigable listbox. Dark-only,
 * styled with the project's neutral/sky tokens. Search auto-enables past 7
 * options; force it either way with `searchable`.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchable,
  disabled = false,
  mono = false,
  placement = "down",
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Show the search field. Defaults to auto-on when there are > 7 options. */
  searchable?: boolean;
  disabled?: boolean;
  /** Render trigger + options in the mono font (matches code/branch/agent UIs). */
  mono?: boolean;
  /** Open the popover below (default) or above the trigger — use `up` when the
   *  select sits near the bottom of its container so the menu isn't cut off. */
  placement?: "down" | "up";
  /** Extra classes for the root (use for width/layout, e.g. `w-full`). */
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Index of the highlighted option within the *filtered* list.
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();

  const showSearch = searchable ?? options.length > 7;
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!showSearch || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [options, query, showSearch]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus the search field when the popover opens (DOM sync, no state writes).
  useEffect(() => {
    if (!open || !showSearch) return;
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, showSearch]);

  // The stored highlight can fall out of range after filtering; clamp it on read.
  const activeIdx = filtered.length ? Math.min(active, filtered.length - 1) : 0;

  // Scroll the highlighted option into view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  function openMenu() {
    setQuery("");
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx < 0 ? 0 : idx);
    setOpen(true);
  }

  function choose(opt: SelectOption) {
    if (disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (filtered.length) setActive(Math.min(activeIdx + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (filtered.length) setActive(Math.max(activeIdx - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[activeIdx]) choose(filtered[activeIdx]);
        break;
      case " ":
        // Space selects when focus is on the trigger; in the search field it must type.
        if (!showSearch) {
          e.preventDefault();
          if (filtered[activeIdx]) choose(filtered[activeIdx]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  const mf = mono ? "font-mono" : "";
  const listboxId = `${baseId}-listbox`;
  const activeId = filtered[activeIdx]
    ? `${baseId}-opt-${activeIdx}`
    : undefined;

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className={`relative inline-flex ${className}`}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        // In searchable mode the input below is the combobox; the trigger is a
        // plain activating button. In select-only mode the trigger IS the combobox.
        role={!showSearch ? "combobox" : undefined}
        aria-expanded={!showSearch ? open : undefined}
        aria-controls={!showSearch && open ? listboxId : undefined}
        aria-activedescendant={!showSearch && open ? activeId : undefined}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openMenu();
        }}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-700 bg-neutral-900 py-2 pr-3 pl-3 text-sm text-neutral-100 outline-none focus:border-sky-500 disabled:opacity-50 ${mf}`}
      >
        <span
          className={`min-w-0 flex-1 truncate text-left ${selected ? "" : "text-neutral-500"}`}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-neutral-500" />
      </button>

      {open && (
        <div
          className={`absolute left-0 z-50 max-h-72 w-full min-w-48 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl ${
            placement === "up" ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-neutral-800 px-2.5 py-2">
              <Search className="size-4 shrink-0 text-neutral-500" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Search…"
                role="combobox"
                aria-controls={listboxId}
                aria-expanded={open}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                className={`w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600 ${mf}`}
              />
            </div>
          )}
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-60 overflow-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-neutral-500">No matches</li>
            ) : (
              filtered.map((o, i) => {
                const isSelected = o.value === value;
                const isActive = i === activeIdx;
                return (
                  <li
                    key={o.value}
                    id={`${baseId}-opt-${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o)}
                    className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${
                      isActive ? "bg-neutral-800" : ""
                    } ${mf}`}
                  >
                    {o.icon && (
                      <span className="mt-0.5 shrink-0 text-neutral-400">
                        {o.icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate ${isSelected ? "text-sky-300" : "text-neutral-200"}`}
                      >
                        {o.label}
                      </span>
                      {o.description && (
                        <span className="mt-0.5 block truncate text-xs text-neutral-500">
                          {o.description}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <Check className="mt-0.5 size-4 shrink-0 text-sky-400" />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
