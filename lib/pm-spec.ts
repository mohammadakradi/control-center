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

/** True only for an individual task file — the request's `index.md` summary isn't work. */
export const isPmTaskSpec = (p: string) =>
  isPmTaskPath(p) && !/\/index\.md$/i.test(p);

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

/**
 * A spec's display title: frontmatter `title`, else its first markdown heading, else the
 * filename. Always non-empty — a backlog row with a blank title would be unreadable.
 */
export function specTitle(content: string, path: string): string {
  const fm = parseFrontmatter(content);
  if (fm.title) return fm.title;
  const heading = specBody(content).match(/^#{1,6}[ \t]+(.+)$/m);
  const title = heading?.[1].trim();
  return title || fileStem(path);
}
