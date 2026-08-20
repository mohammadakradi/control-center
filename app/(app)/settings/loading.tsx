import { Skeleton, SkeletonPage } from "@/components/ui-cards";
import { SkeletonCardSection, SkeletonHeader } from "@/components/Skeletons";

/**
 * **Four cards, not two.** `TokenSettings` is one `CardSection` (with a chip in its right
 * slot and a two-column sub-grid of "where to get a token" routes), and `DataSettings` is
 * *three* more — "Back up your data", "Restore from a backup" and "Uninstall". Standing in
 * for the pair of components rather than the four cards they render made the swap jump by
 * two whole cards, which is the largest mismatch a skeleton in this app can have.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading settings…">
      <SkeletonHeader />

      {/* Anthropic token — the header carries a status chip on the right. */}
      <SkeletonCardSection>
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="mt-1.5 h-4 w-2/3 max-w-lg" />
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="rounded-xl border border-line bg-surface-2 p-3.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-1.5 h-3 w-3/4" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="mt-3 h-10 w-28 rounded-lg" />
      </SkeletonCardSection>

      {/* Back up your data. */}
      <SkeletonCardSection headerRight={false}>
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="mt-3 h-10 w-36 rounded-lg" />
      </SkeletonCardSection>

      {/* Restore from a backup — a file field plus its confirm button. */}
      <SkeletonCardSection headerRight={false}>
        <Skeleton className="h-4 w-full max-w-xl" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Skeleton className="h-10 min-w-48 flex-1 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </SkeletonCardSection>

      {/* Uninstall — the danger zone, with its typed-confirmation field. */}
      <SkeletonCardSection headerRight={false}>
        <Skeleton className="h-4 w-full max-w-xl" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Skeleton className="h-10 max-w-44 flex-1 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </SkeletonCardSection>
    </SkeletonPage>
  );
}
