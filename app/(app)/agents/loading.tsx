import { Skeleton, SkeletonPage } from "@/components/ui-cards";
import { SkeletonHeader } from "@/components/Skeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading agents…">
      <SkeletonHeader />

      {/* Two-column card grid; each card is an avatar, a name, and a row of skill pills. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <Skeleton className="h-6 w-32" />
            </div>
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-1.5 h-4 w-2/3" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Array.from({ length: 6 }, (_, j) => (
                <Skeleton key={j} className="h-5 w-14 rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
