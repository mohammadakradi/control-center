/**
 * Minimal YAML frontmatter parsing — the flat `key: value` block at the top of a markdown
 * file. Shared by everything that reads one: agent command/skill files
 * (`lib/discovery/agents.ts`, keys as written) and pm task specs (`lib/pm-spec.ts`, keys
 * lowercased).
 *
 * Deliberately dependency-free: `lib/pm-spec.ts` is imported by a client component, so
 * nothing reachable from here may touch `node:*`.
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  // Split on CRLF too: `.` in the key/value pattern excludes `\r`, so a trailing carriage
  // return would make the whole line fail to match rather than just need trimming.
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
