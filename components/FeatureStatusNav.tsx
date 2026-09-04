import { featureFilterHref, showsFeatureFilter, type FeatureFilter } from "@/lib/ui";
import { FilterPill } from "@/components/ui/filter-pill";

/**
 * Show the active features, or the closed-out ones — the filter both features surfaces share.
 *
 * A closed feature used to stay on screen forever as a collapsed heading, which is right for a
 * project with three of them and clutter above the work in flight on one with thirty. So the
 * lists show active features by default and this brings the rest back.
 *
 * **The count is the point, not decoration.** Hiding rows is only safe if the reader can see
 * that they exist without having to remember they closed them — so the pill says "Closed 24"
 * whether or not it is the selected view, and the split that produces both numbers
 * (`splitFeaturesByStatus`) is tested in `lib/ui.test.ts`.
 *
 * Links rather than client state, so the choice survives SSR and the back button — the same
 * `?project=` / `?range=` idiom the other two filters use, sharing `ProjectFilterNav`'s pill via
 * `FilterPill`. The default view carries no query param, so "Active" and the bare page are one
 * URL; `featureFilterHref` keeps whatever else the page had in the query (`?project=`, `?all=1`).
 *
 * The control **self-guards** via `showsFeatureFilter`, so no caller has to remember the check:
 * with nothing closed there is no choice to make and it renders nothing — unless the reader is
 * already in the closed view, where hiding it would take away the only way back.
 */
export function FeatureStatusNav({
  basePath,
  params,
  filter,
  activeCount,
  closedCount,
  label,
}: {
  /** The page the pills navigate within. */
  basePath: string;
  /** The page's current query, so the links keep the params they aren't about. */
  params: Record<string, string | string[] | undefined>;
  filter: FeatureFilter;
  activeCount: number;
  closedCount: number;
  /**
   * A visible word for what these pills filter, where the surroundings don't already say it.
   *
   * Inside the Features card the heading above the pills is the label, and repeating it would
   * read as "Features · Features". On `/backlog` there is no such heading: the pills sit under a
   * row of *project* pills, on a page whose own subtitle counts "40 open items, and 6 closed" —
   * so an unlabelled "Closed 5" invites exactly the wrong reading, that it filters items.
   */
  label?: string;
}) {
  if (!showsFeatureFilter(filter, closedCount)) return null;

  return (
    <nav
      aria-label="Filter features by status"
      className="flex flex-wrap items-center gap-1.5"
    >
      {/* `aria-hidden`: the nav's own `aria-label` already says this and more, so read aloud
          this span is a stutter before every pill. `pr-1` rather than a wider `gap-x`, so the
          pill-to-pill spacing stays identical to `ProjectFilterNav`'s row above it. */}
      {label && (
        <span aria-hidden="true" className="pr-1 text-xs text-fg-faint">
          {label}
        </span>
      )}
      <FilterPill
        href={featureFilterHref(basePath, params, "active")}
        active={filter === "active"}
        count={activeCount}
        unit="active feature"
      >
        Active
      </FilterPill>
      <FilterPill
        href={featureFilterHref(basePath, params, "closed")}
        active={filter === "closed"}
        count={closedCount}
        unit="closed feature"
      >
        Closed
      </FilterPill>
    </nav>
  );
}
