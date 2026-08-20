import { Skeleton, SkeletonPage } from "@/components/ui-cards";
import { SkeletonHeader } from "@/components/Skeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading projects…">
      <SkeletonHeader />

      {/* The Add-project form sits in its own thinner box above the list. */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end gap-2">
          <Skeleton className="h-10 min-w-48 flex-1 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-20 rounded-lg" />
        </div>
      </div>

      <div className="grid gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4"
          >
            <div className="min-w-0">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="mt-2 h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="size-7 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
