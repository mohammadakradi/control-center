/**
 * Reading and writing the per-agent model policy (`agent_model_policies`).
 *
 * Kept apart from `lib/models.ts` so the vocabulary and the resolution rules stay importable
 * without pulling in the database — the runner's router and the UI both need the rules, and
 * only this module needs a connection.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { agentModelPolicies } from "./db/schema";
import {
  MODEL_LABELS,
  allowedModelsFor,
  isModelAllowed,
  type ModelLabel,
} from "./models";

/** The stored allowlist for one namespace, or null if it has never been configured. */
export function storedPolicy(namespace: string): string[] | null {
  const row = db
    .select()
    .from(agentModelPolicies)
    .where(eq(agentModelPolicies.namespace, namespace))
    .get();
  return row ? row.allowedModels : null;
}

/** Which models this agent may actually run on, defaults and fallback applied. */
export function allowedModels(namespace: string): ModelLabel[] {
  return allowedModelsFor(storedPolicy(namespace));
}

/** Whether this agent may run on this model. */
export function modelAllowed(namespace: string, model: string): boolean {
  return isModelAllowed(model, storedPolicy(namespace));
}

/**
 * Replace an agent's allowlist.
 *
 * Unknown labels are dropped rather than stored: the column is JSON, and a typo persisted
 * here would read as "denied" forever with nothing to show the user why. Storing an empty
 * list is allowed — `allowedModelsFor` keeps the agent dispatchable on the cheapest model —
 * but the caller should refuse it in the UI rather than rely on that.
 */
export function setAllowedModels(namespace: string, models: readonly string[]): ModelLabel[] {
  const clean = MODEL_LABELS.filter((m) => models.includes(m));
  db.insert(agentModelPolicies)
    .values({ namespace, allowedModels: clean, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: agentModelPolicies.namespace,
      set: { allowedModels: clean, updatedAt: new Date() },
    })
    .run();
  return clean;
}

/** Every configured row, for the settings page. Namespaces with no row are absent — the
 *  caller fills them in from the defaults so a fresh install renders correctly. */
export function allPolicies(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of db.select().from(agentModelPolicies).all()) {
    out[row.namespace] = row.allowedModels;
  }
  return out;
}
