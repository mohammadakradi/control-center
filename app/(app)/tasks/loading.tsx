import { Skeleton, SkeletonPage } from "@/components/ui-cards";
import { SkeletonCardSection, SkeletonHeader, SkeletonRows } from "@/components/Skeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading tasks…">
      <SkeletonHeader />

      {/* `ProjectFilterNav`'s chip row. It hides itself with one project, so this is a
          best-guess block — kept short for that reason. */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-full" />
        ))}
      </div>

      {/* One `CardSection` per project group, each capped at 8 rows. */}
      <div className="space-y-5">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonCardSection key={i}>
            <SkeletonRows count={i === 0 ? 6 : 4} />
          </SkeletonCardSection>
        ))}
      </div>
    </SkeletonPage>
  );
}
