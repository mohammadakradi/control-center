import { card, Skeleton, SkeletonPage } from "@/components/ui-cards";
import {
  SkeletonCardSection,
  SkeletonHeader,
  SkeletonRows,
  SkeletonTileRows,
} from "@/components/Skeletons";

/**
 * The dashboard's loading fallback — and, because it sits at the route group's root, the
 * fallback for any segment under `(app)/` that has none of its own. Every route that exists
 * today has one, so in practice this only ever renders for `/`; a route added later gets a
 * dashboard-shaped skeleton until someone gives it its own, which is a better default than
 * the current behaviour (the previous page frozen on screen for the length of the render).
 *
 * Sitting at the root also makes this the skeleton that ends up in every route's *prefetch*
 * payload, since a prefetch stops at the first loading boundary from the root. That sounds
 * like it would flash a dashboard shape before the right skeleton and it doesn't — a
 * `loading.tsx` is client-side JS, so React renders the correct fallback locally the moment
 * navigation starts. Measured: the route-specific skeleton is the only one that appears.
 * See `.fe/notes.md`; don't add a `(dashboard)` route group to "fix" it.
 *
 * **`GettingStarted` has no stand-in here, and that is a weaker call than the `TokenNudge`
 * omission elsewhere** — it renders `null` only once a token, a project and a first task all
 * exist, so on a *brand-new* install it's the main thing on this page and its arrival will
 * shift the cards below it. Left out because that state is one-time and brief while the jump
 * would otherwise be paid on every dashboard load forever. Revisit if first-run ever matters
 * more than steady state.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading dashboard…">
      <SkeletonHeader />

      {/* The four stat tiles. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${card} flex items-center gap-4`}>
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="min-w-0">
              <Skeleton className="h-8 w-10" />
              <Skeleton className="mt-1.5 h-3 w-16" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SkeletonCardSection>
          <SkeletonTileRows count={3} />
        </SkeletonCardSection>
        <SkeletonCardSection>
          <SkeletonTileRows count={4} />
        </SkeletonCardSection>
      </div>

      <SkeletonCardSection>
        <SkeletonRows count={6} />
      </SkeletonCardSection>
    </SkeletonPage>
  );
}
