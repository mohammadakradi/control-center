import Link from "next/link";

/**
 * One choice in a row of URL-driven filter pills.
 *
 * **A link, never a button.** Every filter in this app puts its selection in the query string
 * (`?project=`, `?features=`), which keeps the page it filters a server component — no fetch, no
 * loading flash, no client JS — and makes the filtered view bookmarkable and reachable with the
 * back button. `aria-current="page"` is the honest ARIA for something that navigates;
 * `role="radio"` would be a lie to a screen reader. Reach for `SegmentedControl` instead only
 * when the state genuinely can't leave the client (the colour theme).
 *
 * Extracted from `ProjectFilterNav`, where it was module-local, when `FeatureStatusNav` became
 * the second nav wanting exactly this treatment. Deliberately **not** merged with
 * `SpendRangeNav`: that one is a segmented *track* (a bordered container with `rounded-md` tabs
 * inside it), a different treatment for a small fixed set, and folding both into one component
 * means a variant flag that makes it render two unrelated looks.
 *
 * Wrapping pills are the right shape when the number of choices is unbounded or the row shares
 * space with other controls — they stack instead of overflowing a 390px viewport.
 */
export function FilterPill({
  href,
  active,
  count,
  unit,
  children,
}: {
  href: string;
  active: boolean;
  /** Omit where there is no number worth showing. */
  count?: number;
  /** What a count counts, for the screen-reader text ("…, 3 items"). */
  unit: string;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-line-strong bg-surface-3 text-fg-strong"
          : "border-line bg-surface-2 text-fg-faint hover:border-line-strong hover:text-fg-muted"
      }`}
    >
      {/* A long project name truncates rather than pushing the pill past the viewport. */}
      <span className="min-w-0 truncate">{children}</span>
      {/* The bare number is ambiguous read aloud ("Platform 12"), so it's hidden and the
          sr-only span says it in words. `fg-faint`, not `fg-ghost` — this is real text a
          sighted user reads, and `fg-ghost` is decorative-only by contract (sub-AA). */}
      {count !== undefined && (
        <>
          <span aria-hidden="true" className="shrink-0 text-fg-faint">
            {count}
          </span>
          <span className="sr-only">{`, ${count} ${unit}${count === 1 ? "" : "s"}`}</span>
        </>
      )}
    </Link>
  );
}
