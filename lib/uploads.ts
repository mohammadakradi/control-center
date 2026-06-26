import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { UPLOADS_DIR } from "./config";
import type { Attachment } from "./db/schema";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB each

/** Save uploaded files under data/uploads/<taskId>/ and return their metadata.
 *  `existingNames` lets a later batch (e.g. a follow-up request) avoid clobbering
 *  files already saved for the same task. */
export async function saveAttachments(
  taskId: string,
  files: File[],
  existingNames: string[] = [],
): Promise<Attachment[]> {
  if (files.length === 0) return [];
  const dir = resolve(UPLOADS_DIR, taskId);
  mkdirSync(dir, { recursive: true });
  const out: Attachment[] = [];
  const used = new Set(existingNames);
  for (const file of files.slice(0, MAX_FILES)) {
    if (file.size === 0 || file.size > MAX_FILE_BYTES) continue;
    // Sanitize to a bare filename; de-dupe collisions.
    let name = basename(file.name).replace(/[^\w.\- ]+/g, "_") || "file";
    while (used.has(name)) name = `_${name}`;
    used.add(name);
    const abs = resolve(dir, name);
    writeFileSync(abs, Buffer.from(await file.arrayBuffer()));
    out.push({
      name,
      path: abs,
      type: file.type || "application/octet-stream",
      size: file.size,
    });
  }
  return out;
}
