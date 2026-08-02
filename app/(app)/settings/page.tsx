import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserTokenStatus, secretsConfigured } from "@/lib/secrets";
import { spendForUser } from "@/lib/usage-summary";
import { PageHeader } from "@/components/ui-cards";
import { TokenSettings } from "@/components/TokenSettings";
import { UsageSummaryCard } from "@/components/UsageSummaryCard";
import { PlanLimits } from "@/components/PlanLimits";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={`Signed in as ${user.email}`}
      />
      <TokenSettings
        initialStatus={getUserTokenStatus(user.id)}
        vaultReady={secretsConfigured()}
      />
      <UsageSummaryCard spend={spendForUser(user.id)} />
      {/* Renders nothing unless the SDK can actually read plan limits — usually it can't. */}
      <PlanLimits />
    </div>
  );
}
