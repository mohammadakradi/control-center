/**
 * Reading a pm task spec — the markdown files the pm agent plans work into, at
 * `.pm/tasks/<timestamp>/<task>.md` inside a project folder.
 *
 * Shared by the file modal (which hands off one spec on demand) and the backlog sync (which
 * imports all of them). Both have to derive the same assignee from the same frontmatter, or
 * the same spec would reach a different agent depending on which route dispatched it — so
 * this is deliberately one module rather than a copy on each side.
 *
 * Imported by a client component, so: no `node:` imports here, and nothing reachable from
 * here may add one.
 */
import { parseFrontmatter as parseRawFrontmatter } from "./frontmatter";


/** A pm task spec lives under `.pm/tasks/<timestamp>/`. */
export const isPmTaskPath = (p: string) => /(^|\/)\.pm\/tasks\//.test(p);

/** True only for an individual task file — the request's index summary isn't work. Both
 *  extensions, matching the scan's own `isIndex`: an `index.markdown` is just as much a
 *  summary, and treating it as work here would offer to dispatch a file the backlog skipped. */
export const isPmTaskSpec = (p: string) =>
  isPmTaskPath(p) && !/\/index\.(md|markdown)$/i.test(p);

/**
 * The `sourcePath` a backlog item would carry for this spec, or `null` when the backlog can't
 * be holding one — so a caller can look the item up by it and dispatch through the backlog
 * instead of straight past it.
 *
 * Stricter than `isPmTaskSpec` on purpose, in the one way that matters: only the **project
 * root's** `.pm/tasks/` is scanned into the backlog, and the scan keys a row on exactly
 * `.pm/tasks/<request>/<file>` (see `scanPmSpecs`). `isPmTaskSpec` accepts a nested path
 * because the file modal can legitimately show a spec inside a workspace member repo — but
 * that file has no row, and matching it loosely (by suffix, say) would link a run to a
 * *different* project's identically-named spec. Hence exact shape, and an exact comparison.
 *
 * A leading `./` is tolerated because these paths are copied out of agent prose, not
 * generated; everything else that doesn't already read as a `sourcePath` is refused rather
 * than repaired.
 */
export function specSourcePath(path: string): string | null {
  const rel = path.replace(/^\.\/+/, "");
  // Two checks rather than one flagged pattern, because they don't want the same casing rule.
  // The *shape* is case-sensitive: `sourcePath` is stored verbatim, so `.PM/tasks/…` is simply
  // a different string and must not resolve to a row keyed under `.pm/`. The *extension* is
  // case-insensitive, matching `scanPmSpecs`'s own `isMarkdown` — the scan would have imported
  // a `README.MD`, so we must be able to find it. Exactly one folder deep, and markdown only:
  // the scan imports nothing else, so any other path can have no row to be matched against.
  if (!/^\.pm\/tasks\/[^/]+\/[^/]+$/.test(rel)) return null;
  if (!/\.(md|markdown)$/i.test(rel)) return null;
  return isPmTaskSpec(rel) ? rel : null;
}

/**
 * A spec's frontmatter, keys lowercased — `Title:` and `title:` must read the same, since
 * these files are hand-written. Best-effort: never throws, no frontmatter is `{}`.
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseRawFrontmatter(content))) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

/** The agents a *spec* can be handed to. pm is deliberately absent: a pm spec is the output of
 *  planning, so routing one back to the planner is a loop, and `targetNamespace` must always
 *  land on someone who implements. */
export type SpecAssignee = "fe" | "swe";

export function isSpecAssignee(v: unknown): v is SpecAssignee {
  return v === "fe" || v === "swe";
}

/**
 * The agents a *backlog item* can be handed to — the implementers plus pm.
 *
 * An item assigned to pm is a problem, not a task: something an agent (or a person) hit and
 * couldn't scope, where the next step is investigation and a breakdown rather than a fix. It
 * dispatches as `/pm:plan`, which is what turns it into specs the sync then imports as real
 * items (see the run route).
 */
export type BacklogAssignee = SpecAssignee | "pm";

export function isBacklogAssignee(v: unknown): v is BacklogAssignee {
  return isSpecAssignee(v) || v === "pm";
}

/** Which agent a spec should go to: explicit `assignee`, else derived from `stack`. */
export function targetNamespace(fm: Record<string, string>): SpecAssignee {
  const a = (fm.assignee || "").toLowerCase();
  if (isSpecAssignee(a)) return a;
  return (fm.stack || "").toLowerCase() === "frontend" ? "fe" : "swe";
}

/** Filename without directories or extension, e.g. `03-backend-backlog-model-api`. */
function fileStem(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.(md|markdown)$/i, "");
}

/**
 * The spec with its frontmatter block removed — what a human is meant to read.
 *
 * A backlog item stores the file verbatim, so anything showing a preview of one would
 * otherwise open with `--- title: … stack: … assignee: …`, which is the least informative
 * 160 characters in the file. Content unchanged when there is no frontmatter.
 */
export function specBody(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").trimStart();
}

/** The first markdown heading in a document, or null. */
function firstHeading(content: string): string | null {
  const heading = specBody(content).match(/^#{1,6}[ \t]+(.+)$/m);
  return heading?.[1].trim() || null;
}

/**
 * A request folder's display name — what the *feature* derived from it is called.
 *
 * A `.pm/tasks/<request>/` folder is a batch of planned work, and its `index.md` carries the
 * one-line summary a human wrote for it ("Feature grouping, feature branches, and parallel
 * runs"), which is exactly the name a grouped list wants. `indexContent` is null when the
 * folder has no index, or when the scan refused to read it — then the folder name is all
 * there is, so its timestamp prefix comes off and its dashes become spaces.
 *
 * Deliberately not `specTitle`: that falls back to the *filename*, which here is the word
 * "index" for every request folder in the project.
 */
export function requestTitle(indexContent: string | null, dir: string): string {
  if (indexContent) {
    const fm = parseFrontmatter(indexContent);
    if (fm.title) return fm.title;
    const heading = firstHeading(indexContent);
    if (heading) return heading;
  }
  const base = (dir.split("/").pop() ?? dir).trim();
  // pm names these `<yyyymmdd>-<hhmmss>-<slug>`; older batches may carry only the date.
  const words = base.replace(/^\d{8}(?:-\d{6})?-/, "").replace(/[-_]+/g, " ").trim();
  const [first = "", ...rest] = [...(words || base)];
  return first.toUpperCase() + rest.join("");
}

/**
 * A spec's display title: frontmatter `title`, else its first markdown heading, else the
 * filename. Always non-empty — a backlog row with a blank title would be unreadable.
 */
export function specTitle(content: string, path: string): string {
  const fm = parseFrontmatter(content);
  if (fm.title) return fm.title;
  return firstHeading(content) || fileStem(path);
}
