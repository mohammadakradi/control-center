import { Skeleton, SkeletonPage } from "@/components/ui-cards";
import {
  SkeletonCardSection,
  SkeletonDetailHeader,
  SkeletonFacts,
  SkeletonRows,
  SkeletonTiles,
} from "@/components/Skeletons";

/**
 * The most valuable skeleton in the app: this page re-scans the project, reads git branch
 * info and walks the working tree for changes, which measured **2.7 s of frozen previous
 * page** before this boundary existed.
 *
 * `TokenNudge` is deliberately not represented. It renders nothing once a token is saved,
 * which is the normal case — standing in for it would add a block that then vanishes, and a
 * skeleton that disagrees with the layout replacing it reads as the page breaking.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading project…" className="">
      <SkeletonDetailHeader chips={3} actions />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* New task — full width, and the tallest block on the page. */}
        <SkeletonCardSection className="lg:col-span-2" headerRight={false}>
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-lg" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-10 w-44 rounded-lg" />
              <Skeleton className="h-10 w-40 rounded-lg" />
              <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
        </SkeletonCardSection>

        {/* At a glance — two tiles over three facts. */}
        <SkeletonCardSection>
          <SkeletonTiles count={2} />
          <SkeletonFacts count={3} />
        </SkeletonCardSection>

        {/* Source control. Renders nothing at all for a non-git project, so this is the
            one block here that can be replaced by empty space rather than by content. */}
        <SkeletonCardSection>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
        </SkeletonCardSection>

        <SkeletonCardSection className="lg:col-span-2">
          <SkeletonRows count={5} />
        </SkeletonCardSection>
      </div>
    </SkeletonPage>
  );
}
