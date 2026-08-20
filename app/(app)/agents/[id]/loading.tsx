import { Skeleton, SkeletonPage } from "@/components/ui-cards";
import {
  SkeletonCard,
  SkeletonCardSection,
  SkeletonDetailHeader,
  SkeletonFacts,
  SkeletonRows,
  SkeletonTileRows,
  SkeletonTiles,
} from "@/components/Skeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading agent…" className="">
      <SkeletonDetailHeader avatar={80} chips={3} />
      <Skeleton className="mt-4 h-4 w-full max-w-3xl" />

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* At a glance — four tiles over two facts. The three cards below the header are
            plain `card` sections with their own `<h2>`, not `CardSection`. */}
        <SkeletonCard>
          <Skeleton className="mb-4 h-5 w-28" />
          <SkeletonTiles count={4} />
          <SkeletonFacts count={2} />
        </SkeletonCard>

        <SkeletonCard>
          <Skeleton className="mb-4 h-5 w-40" />
          <SkeletonTileRows count={3} />
        </SkeletonCard>

        {/* Skills — one small card per command, full width. */}
        <SkeletonCard className="lg:col-span-2">
          <Skeleton className="mb-4 h-5 w-16" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="rounded-xl border border-line bg-surface-2 p-3.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-3 w-40 max-w-full" />
              </div>
            ))}
          </div>
        </SkeletonCard>

        <SkeletonCardSection className="lg:col-span-2">
          <SkeletonRows count={5} />
        </SkeletonCardSection>
      </div>
    </SkeletonPage>
  );
}
