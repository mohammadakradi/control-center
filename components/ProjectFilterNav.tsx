import Link from "next/link";

/** The page this control filters. Its own `?project=` is the only state it has. */
const TASKS_PATH = "/tasks";

export type ProjectFilterOption = { id: string; name: string; count: number };

/**
 * Project filter for the Tasks page.
 *
 * Links rather than buttons, for the same reasons as `SpendRangeNav`: the selection
 * lives in the URL, so the page stays a server component (no fetch, no loading flash, no
 * client JS), the filtered view is bookmarkable and reachable with the back button, and
 * `aria-current="page"` is the honest ARIA for something that navigates.
 *
 * Wrapping pills rather than that component's fixed segmented control, because the number of
 * projects is unbounded — a segmented bar would either overflow the viewport or squeeze names
 * to nothing. The default ("All projects") carries no query param, so `/tasks` and the
 * unfiltered view are the same URL.
 *
 * Only projects that actually have tasks are worth offering: a filter that leads to a
 * guaranteed empty list is a dead end, and this page is scoped to one owner's runs, so most
 * projects on a shared device may legitimately have none of them. By the same argument the
 * control **self-guards** — with fewer than two projects there is no choice to make, so it
 * renders nothing rather than leaving every caller to remember the check.
 */
export function ProjectFilterNav({
  projects,
  selected,
}: {
  /** Projects with at least one task, in the order the groups are rendered. */
  projects: ProjectFilterOption[];
  /** Selected project id, or null for "All projects". */
  selected: string | null;
}) {
  if (projects.length < 2) return null;

  const total = projects.reduce((sum, p) => sum + p.count, 0);

  return (
    <nav
      aria-label="Filter tasks by project"
      className="flex flex-wrap items-center gap-1.5"
    >
      <FilterPill href={TASKS_PATH} active={selected === null} count={total}>
        All projects
      </FilterPill>
      {projects.map((p) => (
        <FilterPill
          key={p.id}
          href={`${TASKS_PATH}?project=${encodeURIComponent(p.id)}`}
          active={selected === p.id}
          count={p.count}
        >
          {p.name}
        </FilterPill>
      ))}
    </nav>
  );
}

function FilterPill({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count: number;
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
      <span aria-hidden="true" className="shrink-0 text-fg-faint">
        {count}
      </span>
      <span className="sr-only">{`, ${count} task${count === 1 ? "" : "s"}`}</span>
    </Link>
  );
}
