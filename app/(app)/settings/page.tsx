import { getCurrentUser } from "@/lib/auth";
import { getUserTokenStatus, secretsConfigured } from "@/lib/secrets";
import { PageHeader } from "@/components/ui-cards";
import { TokenSettings } from "@/components/TokenSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Sign-in is optional: without one this is the local workspace, which has its own token
  // and its own spend.
  const user = await getCurrentUser();

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
    </div>
  );
}
