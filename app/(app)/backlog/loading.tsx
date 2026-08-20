import { Skeleton, SkeletonPage } from "@/components/ui-cards";
import { SkeletonCardSection, SkeletonHeader } from "@/components/Skeletons";

/**
 * `/backlog` pays for a `.pm/tasks/` filesystem scan on every load — measured at ~720 ms of
 * frozen previous page before this boundary existed, and unbounded by anything the client
 * controls, since the cost is the project's spec count.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading backlog…">
      {/* This page passes `actions` (Add item + Open project). */}
      <SkeletonHeader actions />

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-32 rounded-full" />
        ))}
      </div>

      <div className="space-y-5">
        <SkeletonCardSection>
          <ul>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="border-t border-line py-3 first:border-t-0">
                <div className="flex items-start gap-3">
                  <Skeleton className="mt-1 size-2.5 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-56 max-w-full" />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  </div>
                  <Skeleton className="h-8 w-24 shrink-0 rounded-lg" />
                </div>
              </li>
            ))}
          </ul>
        </SkeletonCardSection>
      </div>
    </SkeletonPage>
  );
}
