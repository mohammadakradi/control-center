import { getCurrentUser, getSignedInUser } from "@/lib/auth";
import { getUserTokenStatus, secretsConfigured } from "@/lib/secrets";
import { PageHeader } from "@/components/ui-cards";
import { TokenSettings } from "@/components/TokenSettings";
import { DataSettings } from "@/components/DataSettings";
import { VersionSettings } from "@/components/VersionSettings";
import { AgentModelSettings } from "@/components/AgentModelSettings";
import { allPolicies } from "@/lib/agent-policy";
import { MODEL_LABELS, allowedModelsFor } from "@/lib/models";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Sign-in is optional: without one this is the local workspace, which has its own token
  // and its own spend.
  const user = await getCurrentUser();
  const signedIn = await getSignedInUser();

  // Resolved through the same helper the router uses, so this shows what will actually happen
  // rather than the raw column — a namespace with no row reads as the defaults, not as empty.
  const stored = allPolicies();
  const namespaces = [
    ...new Set(db.select({ ns: agents.namespace }).from(agents).all().map((r) => r.ns)),
  ].sort();
  const modelPolicy = {
    models: [...MODEL_LABELS],
    policies: Object.fromEntries(
      namespaces.map((ns) => [ns, allowedModelsFor(stored[ns] ?? null)]),
    ),
  };

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
      {/* Which models each agent may run on. Above Version/Data because it is the one users
          actually come here to change after the token — and it is what keeps a run from
          quietly costing double. */}
      <AgentModelSettings initial={modelPolicy} />
      <VersionSettings />
      {/* Backup, restore and uninstall. Install-wide, so the API refuses each once there is
          more than one account — this can't become a way to take, or delete, someone else's
          history from a shared install. */}
      <DataSettings />
    </div>
  );
}
