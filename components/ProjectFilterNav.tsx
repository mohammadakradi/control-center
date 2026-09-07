import { FilterPill } from "@/components/ui/filter-pill";

export type ProjectFilterOption = {
  id: string;
  name: string;
  /** Shown beside the name. Omit where there is no number worth showing. */
  count?: number;
};

/**
 * Pick a project — the filter on `/tasks`, and the project switcher on `/backlog`.
 *
 * Links rather than buttons, for the same reasons as `SpendRangeNav`: the selection
 * lives in the URL, so the page stays a server component (no fetch, no loading flash, no
 * client JS), the filtered view is bookmarkable and reachable with the back button, and
 * `aria-current="page"` is the honest ARIA for something that navigates. The pill itself is
 * `FilterPill` (`components/ui/filter-pill.tsx`), shared with `FeatureStatusNav` — it lived
 * here until a second nav wanted the same treatment.
 *
 * Wrapping pills rather than that component's fixed segmented control, because the number of
 * projects is unbounded — a segmented bar would either overflow the viewport or squeeze names
 * to nothing.
 *
 * The control **self-guards**: with fewer than two projects there is no choice to make, so it
 * renders nothing rather than leaving every caller to remember the check.
 *
 * The two callers differ in ways that are all data, not markup — which is why this is one
 * component and not two. `/tasks` filters, so it offers "All projects" (no query param, so
 * the default view and `/tasks` are the same URL) and lists only projects that have tasks,
 * since a filter leading to a guaranteed-empty list is a dead end. `/backlog` shows one
 * project at a time, so there is no "all", and it lists **every** project — a project with
 * nothing recorded yet is exactly where you'd go to import or add the first item.
 */
export function ProjectFilterNav({
  projects,
  selected,
  basePath = "/tasks",
  showAll = true,
  unit = "task",
  ariaLabel = "Filter tasks by project",
}: {
  projects: ProjectFilterOption[];
  /** Selected project id, or null for "All projects". */
  selected: string | null;
  /** Page the pills navigate within. */
  basePath?: string;
  /** Offer an unfiltered "All projects" pill. */
  showAll?: boolean;
  /** What a count counts, for the screen-reader text ("…, 3 items"). */
  unit?: string;
  ariaLabel?: string;
}) {
  if (projects.length < 2) return null;

  const counted = projects.filter(
    (p): p is ProjectFilterOption & { count: number } => p.count !== undefined,
  );
  const total = counted.length > 0 ? counted.reduce((sum, p) => sum + p.count, 0) : undefined;

  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap items-center gap-1.5">
      {showAll && (
        <FilterPill href={basePath} active={selected === null} count={total} unit={unit}>
          All projects
        </FilterPill>
      )}
      {projects.map((p) => (
        <FilterPill
          key={p.id}
          href={`${basePath}?project=${encodeURIComponent(p.id)}`}
          active={selected === p.id}
          count={p.count}
          unit={unit}
        >
          {p.name}
        </FilterPill>
      ))}
    </nav>
  );
}
