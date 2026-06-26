import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { agents, type AgentCommand } from "../db/schema";
import { INSTALLED_PLUGINS_JSON, KNOWN_MARKETPLACES_JSON } from "../config";
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

/** Read installed Claude Code plugins and turn them into agent records. */
export function discoverAgents(): DiscoveredAgent[] {
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
      readJson<{ name?: string; description?: string }>(
        resolve(pluginDir, ".claude-plugin/plugin.json"),
      ) ?? {};
    const namespace = manifest.name ?? pluginKey.split("@")[0];

    result.push({
      id: pluginKey,
      name: namespace,
      namespace,
      sourcePath: pluginDir,
      pluginId: pluginKey,
      description: manifest.description ?? null,
      commands: readCommands(pluginDir, namespace),
      scope: entry.scope ?? null,
    });
  }
  // This platform surfaces the locally-built agents (swe, fe, pm).
  const SURFACED = new Set(["swe", "fe", "pm"]);
  return result.filter((a) => SURFACED.has(a.namespace));
}

/** Discover installed plugins and upsert them into the DB. Returns the current agent set. */
export function syncAgents() {
  const discovered = discoverAgents();
  for (const a of discovered) {
    db.insert(agents)
      .values(a)
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          name: a.name,
          namespace: a.namespace,
          sourcePath: a.sourcePath,
          description: a.description,
          commands: a.commands,
          scope: a.scope,
        },
      })
      .run();
  }
  // Drop agents that are no longer installed.
  const liveIds = new Set(discovered.map((a) => a.id));
  for (const row of db.select({ id: agents.id }).from(agents).all()) {
    if (!liveIds.has(row.id))
      db.delete(agents).where(eq(agents.id, row.id)).run();
  }
  return db.select().from(agents).all();
}
