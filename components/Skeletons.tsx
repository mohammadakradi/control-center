import type { ReactNode } from "react";
import { card, Skeleton } from "@/components/ui-cards";

/**
 * Composite skeleton shapes, for the `app/(app)/**\/loading.tsx` route fallbacks.
 *
 * `Skeleton` and `SkeletonPage` are the primitives and live in `components/ui-cards.tsx`
 * with the rest of the core UI. What lives here is the next layer up: the handful of *page
 * shapes* that more than one route needs, so ten loading files don't each re-derive what a
 * card header or a task row looks like.
 *
 * **The one rule that matters:** every className below is copied from the real component it
 * stands in for (`PageHeader`, `card`, `CardSection`, `Tile`, `TaskList`), so the skeleton
 * occupies the same box as the content replacing it. When a skeleton's padding or grid
 * disagrees with the real thing, the swap becomes a visible jump — which is worse than no
 * skeleton at all, because it reads as the page breaking rather than the page arriving.
 * If you change one of those components' shells, change it here too.
 */

/** Bar widths cycle through a fixed list rather than `Math.random()`, which would differ
 *  between the server and client renders and so be a hydration mismatch. Deterministic,
 *  and still ragged enough to read as text rather than as a table. */
const TITLE_WIDTHS = ["w-64", "w-48", "w-72", "w-40", "w-56"];
const META_WIDTHS = ["w-24", "w-32", "w-20", "w-28"];

/** Mirrors `PageHeader` — a `text-2xl` title and its `text-sm` description. */
export function SkeletonHeader({ actions = false }: { actions?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      </div>
      {actions && <Skeleton className="h-9 w-32 shrink-0 rounded-lg" />}
    </div>
  );
}

/** The `card` surface, for a block whose innards the caller supplies. */
export function SkeletonCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`${card} min-w-0 ${className}`}>{children}</div>;
}

/** Mirrors `CardSection`: the card plus its `mb-4` header row. */
export function SkeletonCardSection({
  className = "",
  headerRight = true,
  children,
}: {
  className?: string;
  /** `CardSection`'s optional right slot — a count, or a "View all" link. */
  headerRight?: boolean;
  children: ReactNode;
}) {
  return (
    <SkeletonCard className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Skeleton className="h-5 w-32" />
        {headerRight && <Skeleton className="h-4 w-16" />}
      </div>
      {children}
    </SkeletonCard>
  );
}

/** Task-history rows, matching `TaskList`'s `border-t` list and `px-2 py-3` row.
 *
 *  **A `TaskList` row has no avatar.** It leads with a fixed-width monospace `/ns:command`
 *  tag (`min-w-28 shrink-0 font-mono text-xs text-accent`), then the task name takes the
 *  remaining width, then metadata. An earlier version of this put a round avatar there and
 *  every task list in the app promised a photo that never arrived — a circle turning into a
 *  text tag is the most visible kind of swap there is. Keep the leading bar rectangular and
 *  28-wide. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <ul>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="border-t border-line first:border-t-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 py-3">
            <Skeleton className="h-4 w-28 shrink-0" />
            <Skeleton className={`h-4 ${TITLE_WIDTHS[i % TITLE_WIDTHS.length]} max-w-full`} />
            <Skeleton className={`ml-auto h-5 ${META_WIDTHS[i % META_WIDTHS.length]} rounded-full`} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Bordered list rows for the agent/project pickers on the dashboard and agent detail —
 *  `bg-surface-2` tiles rather than `TaskList`'s bordered rows. */
export function SkeletonTileRows({ count = 4 }: { count?: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3"
        >
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className={`h-4 ${TITLE_WIDTHS[i % TITLE_WIDTHS.length]} max-w-full`} />
            <Skeleton className="mt-1.5 h-3 w-24" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Mirrors the `Tile` stat grid (`grid-cols-2` on detail pages, wider on the dashboard). */
export function SkeletonTiles({
  count = 2,
  className = "grid grid-cols-2 gap-3",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-1 rounded-xl border border-line bg-surface-2 px-4 py-3.5"
        >
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Mirrors `Fact` rows — the bordered list under a stat grid. */
export function SkeletonFacts({ count = 3 }: { count?: number }) {
  return (
    <ul className="mt-4 flex flex-col">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0"
        >
          <Skeleton className="size-4 shrink-0" />
          <Skeleton className={`h-4 ${META_WIDTHS[i % META_WIDTHS.length]}`} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The header the three detail pages share: a back link, then a big title with metadata
 * chips under it. `avatar` sizes the disc — 56px on a task, 80px on an agent, absent on a
 * project — and `chips` is how many metadata pills follow the title.
 *
 * `subtitle` is the one line between the title and the chips — the task page's
 * `/namespace:command` in accent mono. It has to be a prop rather than something the caller
 * appends, because it sits *inside* the text column: rendering it as a sibling of this
 * component means hand-indenting it past the avatar, which is both a magic value and the
 * wrong stacking order (the real page puts it above the chips, not below them).
 */
export function SkeletonDetailHeader({
  avatar,
  chips = 3,
  actions = false,
  subtitle = false,
  footer = false,
}: {
  avatar?: 56 | 80;
  chips?: number;
  actions?: boolean;
  subtitle?: boolean;
  /** A last line *below* the chips but still inside the text column — the task page's
   *  project path. Same reason as `subtitle`: a sibling bar would lose the avatar indent. */
  footer?: boolean;
}) {
  return (
    <>
      <Skeleton className="h-5 w-24" />
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          {avatar && (
            <Skeleton
              className={`shrink-0 rounded-full ${avatar === 80 ? "size-20" : "size-14"}`}
            />
          )}
          <div className="min-w-0">
            <Skeleton className="h-8 w-56 max-w-full" />
            {subtitle && <Skeleton className="mt-1.5 h-4 w-40" />}
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              {Array.from({ length: chips }, (_, i) => (
                <Skeleton
                  key={i}
                  className={`h-6 ${META_WIDTHS[i % META_WIDTHS.length]} rounded-full`}
                />
              ))}
            </div>
            {footer && <Skeleton className="mt-1.5 h-3 w-64 max-w-full" />}
          </div>
        </div>
        {actions && (
          <div className="flex shrink-0 items-start gap-2">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-20 rounded-lg" />
          </div>
        )}
      </div>
    </>
  );
}
