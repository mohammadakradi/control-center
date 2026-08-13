import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { UPLOADS_DIR } from "./config";
import type { Attachment } from "./db/schema";

export const MAX_FILES = 10; // per request
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB each

/**
 * Cumulative ceilings for one task, across every batch it ever receives.
 *
 * The per-request caps bound a single upload; they don't bound a *sequence* of them. A task
 * takes files at dispatch, at each gate answer, and on every follow-up, so without these two
 * an owner (or anyone reaching the loopback API, since sign-in is optional) could keep adding
 * batches to one task and fill the disk. Found by the security review of the gate-attachment
 * change. Generous on purpose — a real conversation with a dozen screenshots must not hit it.
 */
export const MAX_TASK_FILES = 30;
export const MAX_TASK_BYTES = 100 * 1024 * 1024; // 100 MB per task, all batches together

/**
 * `request.formData()`, but a body it can't parse is an answer instead of a crash.
 *
 * Undici throws `Failed to parse body as FormData` for a `multipart/form-data` request whose
 * header carries no `boundary`, and an unhandled throw in a route handler is an HTML 500 — so
 * the browser's `res.json()` yields nothing and the composer showed a bare "Failed to dispatch
 * task" with no cause. This install's log had seven of those and there was no way to tell what
 * had been sent. Returns null on failure, having logged the content-type that caused it.
 */
export async function readFormData(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch (err) {
    console.error(
      "[uploads] unreadable multipart body — content-type:",
      JSON.stringify(request.headers.get("content-type")),
      "-",
      (err as Error).message,
    );
    return null;
  }
}

/** What to tell the user when their upload didn't arrive intact. */
export const BAD_MULTIPART =
  "The upload didn't arrive intact — the request body wasn't valid form data. Try again, or send the request without the attachment.";

/**
 * The note appended to a prompt (or to gate feedback) that points the agent at files the user
 * attached. The agent gets paths, not content: `Read` renders images visually and parses
 * PDFs/docs, and a path costs nothing until it's read.
 *
 * Shared so the initial dispatch, a follow-up and a gate reply all phrase it identically —
 * three copies of this sentence is how one of them ends up not mentioning the Read tool.
 */
export function attachmentNote(files: Attachment[], context: string): string {
  if (files.length === 0) return "";
  return (
    `\n\nThe user attached ${files.length} file(s) ${context}. Read each with the Read tool ` +
    "before acting on it (images render visually; PDFs and docs are parsed):\n" +
    files
      .map((a) => `- ${a.path}  (${a.type}, ${Math.round(a.size / 1024)} KB)`)
      .join("\n")
  );
}

/**
 * Save uploaded files under data/uploads/<taskId>/ and return their metadata.
 *
 * `existing` is what the task already holds, and does two jobs: a later batch (a gate answer,
 * a follow-up) avoids clobbering names already used, and the per-task ceilings above are
 * enforced against the running total rather than just this batch. Anything over a cap is
 * skipped, not an error — the request still carries whatever fitted, and the caller reports
 * the count it got back.
 */
export async function saveAttachments(
  taskId: string,
  files: File[],
  existing: Attachment[] = [],
): Promise<Attachment[]> {
  if (files.length === 0) return [];
  const slots = Math.min(MAX_FILES, MAX_TASK_FILES - existing.length);
  if (slots <= 0) return [];
  let budget = MAX_TASK_BYTES - existing.reduce((sum, a) => sum + (a.size || 0), 0);

  const dir = resolve(UPLOADS_DIR, taskId);
  mkdirSync(dir, { recursive: true });
  const out: Attachment[] = [];
  const used = new Set(existing.map((a) => a.name));
  for (const file of files.slice(0, slots)) {
    if (file.size === 0 || file.size > MAX_FILE_BYTES) continue;
    if (file.size > budget) continue; // the task's cumulative ceiling
    // Sanitize to a bare filename; de-dupe collisions. `basename` already drops every
    // `/`-separated segment, so this can't traverse — but "." and ".." survive the regex and
    // would resolve to the directory itself (an EISDIR write, i.e. a failed request), so they
    // are named explicitly rather than left to chance.
    let name = basename(file.name).replace(/[^\w.\- ]+/g, "_") || "file";
    if (name === "." || name === "..") name = "file";
    while (used.has(name)) name = `_${name}`;
    used.add(name);
    const abs = resolve(dir, name);
    writeFileSync(abs, Buffer.from(await file.arrayBuffer()));
    budget -= file.size;
    out.push({
      name,
      path: abs,
      type: file.type || "application/octet-stream",
      size: file.size,
    });
  }
  return out;
}
