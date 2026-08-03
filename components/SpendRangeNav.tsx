import Link from "next/link";
import type { SpendRange } from "@/lib/usage-summary";
import { SPEND_RANGES } from "@/lib/usage-format";

/** The page this control filters. Its own `?range=` is the only state it has. */
const USAGE_PATH = "/usage";

/**
 * Time-window filter for the Usage page.
 *
 * Deliberately links rather than the `role="radiogroup"` buttons `ThemeToggle` uses, even
 * though the two look identical. The theme lives in `localStorage` and can only be read on
 * the client; the range lives in the URL, so a plain navigation is enough — which keeps the
 * spend cards server-rendered (no fetch, no loading flash), makes a range bookmarkable and
 * reachable with the back button, and needs no JavaScript at all. `role="radio"` on
 * something that navigates would also be a lie to a screen reader.
 *
 * The default range carries no query param, so `/usage` and "All time" are the same URL.
 */
export function SpendRangeNav({ value }: { value: SpendRange }) {
  return (
    <nav
      aria-label="Spend range"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
    >
      {SPEND_RANGES.map((range) => {
        const active = range.value === value;
        return (
          <Link
            key={range.value}
            href={range.value === "all" ? USAGE_PATH : `${USAGE_PATH}?range=${range.value}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-surface text-fg-strong shadow-sm"
                : "text-fg-faint hover:text-fg-muted"
            }`}
          >
            {range.short}
          </Link>
        );
      })}
    </nav>
  );
}
