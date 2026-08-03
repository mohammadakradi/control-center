import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { parseRange, spendForUser } from "@/lib/usage-summary";
import { PageHeader } from "@/components/ui-cards";
import { SpendRangeNav } from "@/components/SpendRangeNav";
import { UsageSummaryCard } from "@/components/UsageSummaryCard";
import { ProjectSpendCard } from "@/components/ProjectSpendCard";
import { PlanLimits } from "@/components/PlanLimits";

export const dynamic = "force-dynamic";

export default async function UsagePage({
  searchParams,
}: {
  // Async in Next 16 — see node_modules/next/dist/docs/.../file-conventions/page.md.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  // A hand-edited or stale `?range=` falls back to the default rather than erroring: this
  // is a page with a perfectly good default view, not the API, which does reject it. A
  // repeated param arrives as an array, and there's no sane way to honour two windows at
  // once, so that falls back too.
  const requested = (await searchParams).range;
  const range = parseRange(typeof requested === "string" ? requested : null) ?? "all";
  const spend = spendForUser(user.id, { range });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage"
        description="Tokens and cost for the tasks you dispatched."
        actions={<SpendRangeNav value={range} />}
      />
      <UsageSummaryCard spend={spend} />
      <ProjectSpendCard spend={spend} />
      {/* Renders nothing unless the SDK can actually read plan limits — usually it can't. */}
      <PlanLimits />
    </div>
  );
}
