import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { agents, tasks, type AgentCommand } from "../db/schema";
import {
  BUNDLED_AGENTS_DIR,
  INSTALLED_PLUGINS_JSON,
  KNOWN_MARKETPLACES_JSON,
} from "../config";
import { parseFrontmatter } from "../util";

type InstalledEntry = {
  scope?: string;
  installPath?: string;
  version?: string;
};
type InstalledPlugins = { plugins?: Record<string, InstalledEntry[]> };
type Marketplaces = Record<
  string,
  { source?: { source?: string; path?: string }; installLocation?: string }
>;

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function pluginDirOf(entry: InstalledEntry, marketplaceDir: string | null) {
  // Prefer the live marketplace directory (picks up source edits); fall back to the cached installPath.
  const candidates = [marketplaceDir, entry.installPath].filter(
    Boolean,
  ) as string[];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, ".claude-plugin/plugin.json"))) return dir;
  }
  return candidates[0] ?? null;
}

function readCommands(pluginDir: string, namespace: string): AgentCommand[] {
  const cmdDir = resolve(pluginDir, "commands");
  if (!existsSync(cmdDir)) return [];
  const out: AgentCommand[] = [];
  for (const file of readdirSync(cmdDir)) {
    if (!file.endsWith(".md")) continue;
    const name = basename(file, ".md");
    const fm = parseFrontmatter(readFileSync(resolve(cmdDir, file), "utf8"));
    out.push({
      name,
      full: `/${namespace}:${name}`,
      description: fm.description,
      argumentHint: fm["argument-hint"],
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type DiscoveredAgent = typeof agents.$inferInsert;

type PluginManifest = { name?: string; description?: string; version?: string };

/** This platform surfaces the locally-built agents (swe, fe, pm), not every installed plugin. */
const SURFACED = new Set(["swe", "fe", "pm"]);

/** Read installed Claude Code plugins and turn them into agent records. */
function discoverRegistryAgents(): DiscoveredAgent[] {
  const installed = readJson<InstalledPlugins>(INSTALLED_PLUGINS_JSON);
  const marketplaces = readJson<Marketplaces>(KNOWN_MARKETPLACES_JSON) ?? {};
  if (!installed?.plugins) return [];

  const result: DiscoveredAgent[] = [];
  for (const [pluginKey, entries] of Object.entries(installed.plugins)) {
    const entry = entries.find((e) => e.scope === "user") ?? entries[0];
    if (!entry) continue;
    const [, marketplaceName] = pluginKey.split("@");
    const mkt = marketplaces[marketplaceName];
    const marketplaceDir =
      mkt?.source?.source === "directory" && mkt.source.path
        ? mkt.source.path
        : null;

    const pluginDir = pluginDirOf(entry, marketplaceDir);
    if (!pluginDir) continue;

    const manifest =
      readJson<PluginManifest>(
        resolve(pluginDir, ".claude-plugin/plugin.json"),
      ) ?? {};
    const namespace = manifest.name ?? pluginKey.split("@")[0];

    result.push({
      id: pluginKey,
      name: namespace,
      namespace,
      version: manifest.version ?? null,
      sourcePath: pluginDir,
      pluginId: pluginKey,
      description: manifest.description ?? null,
      commands: readCommands(pluginDir, namespace),
      scope: entry.scope ?? null,
    });
  }
  return result.filter((a) => SURFACED.has(a.namespace));
}

/**
 * Read the agent plugins shipped inside the app itself (`agents/<namespace>`).
 *
 * This is what gives a fresh install working agents: a new device has neither the plugin
 * directories nor the Claude Code marketplace entries that point at them, so registry discovery
 * alone returns nothing. Nothing needs to be installed through the CLI for these to *run* —
 * the runner loads a plugin by path (`plugins: [{ type: "local", path }]`), so the registry is
 * only ever how an agent is found, not how it is executed.
 *
 * No namespace filter here: unlike the user's registry (which holds unrelated plugins), whatever
 * is in this directory was shipped deliberately.
 */
export function discoverBundledAgents(
  dir: string = BUNDLED_AGENTS_DIR,
): DiscoveredAgent[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return []; // no bundle — fine, the registry may still have agents
  }

  const out: DiscoveredAgent[] = [];
  for (const name of entries) {
    const pluginDir = resolve(dir, name);
    const manifest = readJson<PluginManifest>(
      resolve(pluginDir, ".claude-plugin/plugin.json"),
    );
    if (!manifest) continue; // not a plugin directory
    const namespace = manifest.name ?? name;
    const id = `${namespace}@bundled`;
    out.push({
      id,
      name: namespace,
      namespace,
      version: manifest.version ?? null,
      sourcePath: pluginDir,
      pluginId: id,
      description: manifest.description ?? null,
      commands: readCommands(pluginDir, namespace),
      scope: "bundled",
    });
  }
  return out;
}

/** All agents available on this machine: CLI-installed plugins first, then the bundled ones. */
export function discoverAgents(): DiscoveredAgent[] {
  const registry = discoverRegistryAgents();
  // A plugin installed through the Claude Code CLI wins over the bundled copy of the same
  // namespace: on a machine where these agents are being developed, that entry points at the
  // live source directory, and its edits should be what runs.
  const claimed = new Set(registry.map((a) => a.namespace));
  return [
    ...registry,
    ...discoverBundledAgents().filter((a) => !claimed.has(a.namespace)),
  ];
}

/** Discover installed plugins and upsert them into the DB. Returns the current agent set. */
export function syncAgents(discovered: DiscoveredAgent[] = discoverAgents()) {
  const liveIds = new Set<string>();
  for (const a of discovered) {
    // The same agent can arrive under a different plugin id than last time — a bundled agent
    // the user later installs through the CLI, or a CLI install that's removed and falls back
    // to the bundled copy. `tasks.agent_id` is a foreign key with ON DELETE CASCADE, so reuse
    // the row already holding that namespace instead of inserting a second one beside it.
    const existing = db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.namespace, a.namespace))
      .get();
    const id = existing?.id ?? a.id;
    liveIds.add(id);
    db.insert(agents)
      .values({ ...a, id })
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          name: a.name,
          namespace: a.namespace,
          version: a.version,
          sourcePath: a.sourcePath,
          pluginId: a.pluginId,
          description: a.description,
          commands: a.commands,
          scope: a.scope,
        },
      })
      .run();
  }
  // Drop agents that are no longer installed — but NEVER one that has task
  // history. `tasks.agent_id` is ON DELETE CASCADE, so deleting an agent here
  // would wipe its tasks + events. Discovery can miss an agent transiently
  // (e.g. while its plugin is being updated), and pruning on that miss would
  // permanently destroy a real agent's history. Agents with tasks are kept.
  for (const row of db.select({ id: agents.id }).from(agents).all()) {
    if (liveIds.has(row.id)) continue;
    const hasHistory = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.agentId, row.id))
      .limit(1)
      .get();
    if (!hasHistory) db.delete(agents).where(eq(agents.id, row.id)).run();
  }
  return db.select().from(agents).all();
}
