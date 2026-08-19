/**
 * Specs for `materializeFiles` — the WebKit `fetch`+`FormData`+live-`File` mitigation applied
 * at all three upload call sites. Node's global `File`/`Blob` (available since Node 20) are
 * already in-memory, so these specs only pin round-trip fidelity (content, name, type,
 * lastModified) — they cannot exercise WebKit's lazy-stream behavior itself, which needs a
 * real WebKit engine and is intermittent even there (it could not be force-reproduced during
 * this task's planning either — see the honesty note in
 * `.swe/test-scenarios/attachment-upload-reliability.md`). That scenario is what to run for a
 * regression check and for confirming the strengthened server-side diagnostics; it is not a
 * substitute for these unit specs, and neither proves the underlying bug is gone.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { materializeFiles } from "./attachments";

test("an empty list stays empty", async () => {
  assert.deepEqual(await materializeFiles([]), []);
});

test("content, name, type and lastModified all survive materialization", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const original = new File([bytes], "shot.png", {
    type: "image/png",
    lastModified: 1700000000000,
  });

  const [out] = await materializeFiles([original]);

  assert.notEqual(out, original, "must be a new File, not the same live handle");
  assert.equal(out.name, "shot.png");
  assert.equal(out.type, "image/png");
  assert.equal(out.lastModified, 1700000000000);
  assert.equal(out.size, bytes.length);
  assert.deepEqual(new Uint8Array(await out.arrayBuffer()), bytes);
});

test("multiple files materialize independently and keep their order", async () => {
  const a = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
  const b = new File([new Uint8Array([2, 2])], "b.txt", { type: "text/plain" });

  const [outA, outB] = await materializeFiles([a, b]);

  assert.equal(outA.name, "a.txt");
  assert.equal(outB.name, "b.txt");
  assert.equal(outA.size, 1);
  assert.equal(outB.size, 2);
});
