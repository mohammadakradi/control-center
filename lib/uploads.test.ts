/**
 * Specs for the upload helpers.
 *
 * `readFormData` exists because of a real failure this install logged seven times: undici
 * throws `Failed to parse body as FormData` when a request says `multipart/form-data` and
 * carries no boundary, and an unhandled throw inside a route handler is an HTML 500 — which
 * the composer can't read an error out of, so it showed "Failed to dispatch task" with no
 * cause. These tests pin the two halves of the fix: a malformed body returns null (so the
 * route can answer 400), and a well-formed one still parses.
 *
 * `attachmentNote` is shared by the initial dispatch, a follow-up and a gate answer, so the
 * wording that tells the agent to *read* the files can't drift between the three.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Attachment } from "./db/schema";

// Must be set before `lib/config` is imported — `UPLOADS_DIR` is derived once, at load. Files
// written by these tests must never land in the repo's real `data/uploads/`.
const dataDir = mkdtempSync(join(tmpdir(), "platform-uploads-test-"));
process.env.PLATFORM_DATA_DIR = dataDir;

type Uploads = typeof import("./uploads");
let uploads: Uploads;
let attachmentNote: Uploads["attachmentNote"];
let readFormData: Uploads["readFormData"];
let BAD_MULTIPART: string;

before(async () => {
  uploads = await import("./uploads");
  ({ attachmentNote, readFormData, BAD_MULTIPART } = uploads);
  const { UPLOADS_DIR } = await import("./config");
  assert.ok(
    UPLOADS_DIR.startsWith(dataDir),
    `refusing to run: uploads would be written to ${UPLOADS_DIR}`,
  );
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

test("a multipart body with no boundary yields null instead of throwing", async () => {
  // Exactly the request shape found in the log: the content-type claims multipart, the
  // boundary parameter is missing. `request.formData()` throws on this.
  const req = new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "multipart/form-data" },
    body: "not really multipart",
  });
  assert.equal(await readFormData(req), null);
});

test("a truncated multipart body yields null too", async () => {
  const req = new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=----abc" },
    body: "------abc\r\ncontent-disposition: form-d", // cut off mid-header
  });
  assert.equal(await readFormData(req), null);
});

test("a well-formed multipart body still parses, files included", async () => {
  const fd = new FormData();
  fd.set("projectId", "p1");
  fd.append("files", new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" }));
  const req = new Request("http://localhost/api/tasks", { method: "POST", body: fd });

  const form = await readFormData(req);
  assert.ok(form, "a real multipart body must not be rejected");
  assert.equal(form!.get("projectId"), "p1");
  const files = form!.getAll("files").filter((f): f is File => f instanceof File);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "shot.png");
});

test("the message shown for a bad body says what to do next", () => {
  // It reaches a user, so it must not be an exception string.
  assert.match(BAD_MULTIPART, /try again/i);
  assert.ok(!/undici|FormData|TypeError/.test(BAD_MULTIPART));
});

test("no attachments means no note at all — nothing appended to the prompt", () => {
  assert.equal(attachmentNote([], "to this request"), "");
});

test("the note carries each path, type and size, and says to Read them", () => {
  const files: Attachment[] = [
    { name: "a.png", path: "/data/uploads/t1/a.png", type: "image/png", size: 2048 },
    { name: "b.pdf", path: "/data/uploads/t1/b.pdf", type: "application/pdf", size: 10 },
  ];
  const note = attachmentNote(files, "with this answer");
  assert.match(note, /attached 2 file\(s\) with this answer/);
  assert.match(note, /Read tool/);
  assert.match(note, /- \/data\/uploads\/t1\/a\.png {2}\(image\/png, 2 KB\)/);
  // A sub-KB file must not read as "0 KB and therefore empty".
  assert.match(note, /b\.pdf {2}\(application\/pdf, \d+ KB\)/);
  assert.ok(note.startsWith("\n\n"), "it is appended to an existing prompt");
});

test("saveAttachments skips empty files and never leaves the task's directory", async () => {
  const saved = await uploads.saveAttachments("task_probe", [
    new File([], "empty.png", { type: "image/png" }),
    new File([new Uint8Array([7])], "../../escape.png", { type: "image/png" }),
    new File([new Uint8Array([7])], "ok.txt", { type: "text/plain" }),
  ]);

  assert.deepEqual(
    saved.map((a) => a.name),
    ["escape.png", "ok.txt"],
    "an empty file is skipped; a traversing name is reduced to its basename",
  );
  assert.deepEqual(readdirSync(join(dataDir, "uploads", "task_probe")).sort(), [
    "escape.png",
    "ok.txt",
  ]);
  for (const a of saved) {
    assert.ok(
      a.path.startsWith(join(dataDir, "uploads", "task_probe")),
      `${a.path} must stay inside the task's own upload directory`,
    );
  }
});

test("a second batch doesn't clobber the first — a repeat name is renamed", async () => {
  // A gate answer and a follow-up both land in the same directory as the original request.
  const first = await uploads.saveAttachments("task_batch", [
    new File([new Uint8Array([1])], "shot.png", { type: "image/png" }),
  ]);
  const second = await uploads.saveAttachments(
    "task_batch",
    [new File([new Uint8Array([2, 2])], "shot.png", { type: "image/png" })],
    first,
  );
  assert.equal(second[0].name, "_shot.png");
  assert.deepEqual(readdirSync(join(dataDir, "uploads", "task_batch")).sort(), [
    "_shot.png",
    "shot.png",
  ]);
});

test("a dot-only filename becomes a real name instead of the directory itself", async () => {
  // `basename` already strips every path segment, so this can't traverse — but ".." resolves
  // to the directory and the write would fail with EISDIR, losing the file for no good reason.
  const saved = await uploads.saveAttachments("task_dots", [
    new File([new Uint8Array([1])], "..", { type: "image/png" }),
    new File([new Uint8Array([1])], ".", { type: "image/png" }),
  ]);
  assert.deepEqual(
    saved.map((a) => a.name),
    ["file", "_file"],
  );
  assert.deepEqual(readdirSync(join(dataDir, "uploads", "task_dots")).sort(), [
    "_file",
    "file",
  ]);
});

test("the per-task file ceiling holds across batches, not just within one", async () => {
  // The security review's finding: per-request caps don't bound a *sequence* of requests, and
  // a gate answer can add files with no agent turn in between.
  const one = () => new File([new Uint8Array([1])], "f.png", { type: "image/png" });
  let held: Attachment[] = [];
  for (let batch = 0; batch < 5; batch++) {
    const got = await uploads.saveAttachments(
      "task_many",
      Array.from({ length: uploads.MAX_FILES }, one),
      held,
    );
    held = [...held, ...got];
  }
  assert.equal(
    held.length,
    uploads.MAX_TASK_FILES,
    "50 files offered over 5 batches must stop at the per-task ceiling",
  );
  // And a further batch adds nothing at all rather than erroring.
  assert.deepEqual(await uploads.saveAttachments("task_many", [one()], held), []);
});

test("the per-task byte ceiling holds across batches", async () => {
  const big = () =>
    new File([new Uint8Array(20 * 1024 * 1024)], "big.bin", { type: "application/octet-stream" });
  let held: Attachment[] = [];
  for (let batch = 0; batch < 8; batch++) {
    const got = await uploads.saveAttachments("task_bytes", [big()], held);
    held = [...held, ...got];
  }
  const total = held.reduce((sum, a) => sum + a.size, 0);
  assert.ok(
    total <= uploads.MAX_TASK_BYTES,
    `${total} bytes stored must not exceed ${uploads.MAX_TASK_BYTES}`,
  );
  assert.equal(held.length, 5, "5 × 20 MB fits in the 100 MB ceiling; the 6th does not");
});
