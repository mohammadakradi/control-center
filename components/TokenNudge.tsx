import Link from "next/link";
import { KeyRound } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { canRunTasks, secretsConfigured } from "@/lib/secrets";
import { buttonClasses } from "@/components/ui/button";

/**
 * Tells a signed-in user they need their own Anthropic token before anything will
 * run. Renders nothing once they're set up, so it disappears the moment a token is
 * saved. Server component — reads the vault directly, never ships token state to
 * the client.
 */
export async function TokenNudge() {
  const user = await getCurrentUser();
  if (!user || canRunTasks(user.id)) return null;

  const vaultReady = secretsConfigured();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-line bg-warn-soft px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-warn">
            Add your Anthropic token to dispatch tasks
          </p>
          <p className="mt-0.5 text-xs text-warn/80">
            {vaultReady
              ? "Agents run on your own Claude plan or API key, so nothing can run until you save one."
              : "The server is missing SECRETS_MASTER_KEY, so token storage is disabled — see .env.example."}
          </p>
        </div>
      </div>
      {vaultReady && (
        <Link href="/settings" className={buttonClasses("secondary", "sm")}>
          Open Settings
        </Link>
      )}
    </div>
  );
}
