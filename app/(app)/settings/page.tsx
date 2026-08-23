import { getCurrentUser, getSignedInUser } from "@/lib/auth";
import { getUserTokenStatus, secretsConfigured } from "@/lib/secrets";
import { PageHeader } from "@/components/ui-cards";
import { TokenSettings } from "@/components/TokenSettings";
import { DataSettings } from "@/components/DataSettings";
import { VersionSettings } from "@/components/VersionSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Sign-in is optional: without one this is the local workspace, which has its own token
  // and its own spend.
  const user = await getCurrentUser();
  const signedIn = await getSignedInUser();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={
          signedIn
            ? `Signed in as ${signedIn.email}`
            : "Local workspace — sign in to keep your token and tasks private from others on this device"
        }
      />
      <TokenSettings
        initialStatus={getUserTokenStatus(user.id)}
        vaultReady={secretsConfigured()}
      />
      {/* Which release this is, and a way to ask GitHub again on the spot. The banner only
          appears when there's something to install, so this is the only place "am I current?"
          has an answer. */}
      <VersionSettings />
      {/* Backup, restore and uninstall. Install-wide, so the API refuses each once there is
          more than one account — this can't become a way to take, or delete, someone else's
          history from a shared install. */}
      <DataSettings />
    </div>
  );
}
