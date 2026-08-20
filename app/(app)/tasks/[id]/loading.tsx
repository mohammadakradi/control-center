import { Skeleton, SkeletonPage } from "@/components/ui-cards";
import { SkeletonCardSection, SkeletonDetailHeader } from "@/components/Skeletons";

/**
 * Task detail. The header is a fixed shape worth mirroring closely (avatar, title, the
 * `/ns:command` line, a row of chips); everything below it is a streamed transcript whose
 * length nothing can predict, so it gets one honest block rather than a guess at rows.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading task…" className="">
      {/* `subtitle` is the `/namespace:command` line, which sits between the title and the
          chips inside the text column — not after them. */}
      {/* `footer` is the project path, present whenever the task's project resolves — i.e.
          effectively always, unlike the usage line below it, which is `hasUsage()`-gated and
          so is deliberately not stood in for. Like `subtitle` it must be a prop: both lines
          live *inside* the header's text column, so a sibling bar would sit at the page edge
          instead of aligned past the avatar. */}
      <SkeletonDetailHeader avatar={56} chips={4} subtitle footer />

      <div className="mt-6 space-y-5">
        {/* The Changes card, which loads its own contents client-side. */}
        <SkeletonCardSection>
          <div className="space-y-2">
            <Skeleton className="h-4 w-52 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        </SkeletonCardSection>

        {/* The transcript. `bg-sunken` is what the real transcript panel uses. */}
        <div className="rounded-2xl border border-line bg-sunken p-6">
          <div className="space-y-3">
            {["w-1/2", "w-5/6", "w-2/3", "w-3/4", "w-1/3", "w-4/5"].map((w, i) => (
              <Skeleton key={i} className={`h-4 ${w}`} />
            ))}
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}
