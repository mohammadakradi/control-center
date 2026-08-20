import { Skeleton, SkeletonPage } from "@/components/ui-cards";
import { SkeletonCardSection, SkeletonHeader, SkeletonRows } from "@/components/Skeletons";

/**
 * Two cards, not three. `PlanLimits` renders nothing at all on this app (env-injected tokens
 * have no profile scope), so standing in for it would promise a card that never arrives.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading usage…">
      {/* This page passes `actions` (the 7d / 30d / all range links). */}
      <SkeletonHeader actions />

      <SkeletonCardSection headerRight={false}>
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 min-w-32 flex-1 rounded-xl" />
          ))}
        </div>
      </SkeletonCardSection>

      <SkeletonCardSection>
        <SkeletonRows count={4} />
      </SkeletonCardSection>
    </SkeletonPage>
  );
}
