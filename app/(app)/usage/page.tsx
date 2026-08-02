import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { spendForUser } from "@/lib/usage-summary";
import { PageHeader } from "@/components/ui-cards";
import { UsageSummaryCard } from "@/components/UsageSummaryCard";
import { PlanLimits } from "@/components/PlanLimits";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage"
        description="Tokens and cost for the tasks you dispatched."
      />
      <UsageSummaryCard spend={spendForUser(user.id)} />
      {/* Renders nothing unless the SDK can actually read plan limits — usually it can't. */}
      <PlanLimits />
    </div>
  );
}
