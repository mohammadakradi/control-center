import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { allPolicies, setAllowedModels } from "@/lib/agent-policy";
import { MODEL_LABELS, allowedModelsFor, defaultAllowedModels } from "@/lib/models";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * Which models each installed agent may run on.
 *
 * Install-wide, like the agents themselves — see the `agentModelPolicies` docstring. It still
 * requires a session-resolved user (which is the local workspace when nobody is signed in),
 * so this is not reachable without going through the app's own auth path.
 */
export async function GET() {
  await getCurrentUser();
  const stored = allPolicies();
  // From the `agents` table (what is actually registered) rather than re-running
  // discovery: this endpoint should describe the install as the dispatcher sees it.
  const namespaces = [
    ...new Set(db.select({ ns: agents.namespace }).from(agents).all().map((r) => r.ns)),
  ].sort();
  return NextResponse.json({
    models: MODEL_LABELS,
    defaults: defaultAllowedModels(),
    // Every installed namespace gets an entry, resolved through the same helper the router
    // uses — so the UI shows what will actually happen, not the raw column.
    policies: Object.fromEntries(
      namespaces.map((ns) => [ns, allowedModelsFor(stored[ns] ?? null)]),
    ),
  });
}

/** PUT { namespace, models: string[] } — replace one agent's allowlist. */
export async function PUT(request: Request) {
  await getCurrentUser();
  let body: { namespace?: unknown; models?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const namespace = typeof body.namespace === "string" ? body.namespace.trim() : "";
  if (!namespace) {
    return NextResponse.json({ error: "namespace is required" }, { status: 400 });
  }
  if (!Array.isArray(body.models) || body.models.some((m) => typeof m !== "string")) {
    return NextResponse.json({ error: "models must be an array of strings" }, { status: 400 });
  }
  // Refused rather than silently repaired: `allowedModelsFor` would keep the agent running on
  // the cheapest model, but saving "nothing allowed" is never what someone means to do, and a
  // UI that appears to accept it would be lying about what it stored.
  const clean = MODEL_LABELS.filter((m) => (body.models as string[]).includes(m));
  if (clean.length === 0) {
    return NextResponse.json(
      { error: "an agent needs at least one allowed model" },
      { status: 400 },
    );
  }

  return NextResponse.json({ namespace, models: setAllowedModels(namespace, clean) });
}
