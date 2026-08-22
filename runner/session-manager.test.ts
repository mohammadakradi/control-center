/**
 * `featureBranchPreamble` — the only guarantee a non-isolated (checkout) feature run gets
 * that its work lands on the feature branch, since the platform never system-merges one (see
 * `launchMode`'s `feature` docstring). Pure string-building plus one DB read, so it's worth
 * pinning directly rather than only through a live dispatch.
 *
 * Runs against a throwaway SQLite file built from the real schema via `drizzle-kit push`,
 * never the app's own `data/platform.db` — the same pattern `backlog-tool.test.ts` uses.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "platform-session-manager-test-"));
const dbFile = join(dir, "test.db");

// Point the shared connection at the throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;
// featureBranchPreamble doesn't touch secrets, but importing session-manager.ts transitively
// imports modules that read this at call time (never at import time) — set it anyway so a
// future change that does read it earlier fails obviously rather than mysteriously.
process.env.SECRETS_MASTER_KEY = Buffer.alloc(32).toString("base64");

type Db = typeof import("../lib/db").db;
type Schema = typeof import("../lib/db/schema");
let db: Db;
let features: Schema["features"];
let featureBranchPreamble: typeof import("./session-manager").featureBranchPreamble;

before(async () => {
  execFileSync(
    "npx",
    [
      "drizzle-kit",
      "push",
      "--dialect=sqlite",
      "--schema=./lib/db/schema.ts",
      `--url=${dbFile}`,
      "--force",
    ],
    { cwd: join(import.meta.dirname, ".."), stdio: "pipe" },
  );

  ({ db } = await import("../lib/db"));
  ({ features } = await import("../lib/db/schema"));

  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  ({ featureBranchPreamble } = await import("./session-manager"));

  const { projects } = await import("../lib/db/schema");
  db.insert(projects).values({ id: "p1", name: "One", path: join(dir, "one") }).run();
  db.insert(features)
    .values({ id: "f1", projectId: "p1", name: "Invoice approval", branch: "feature/invoice-approval" })
    .run();
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("names the feature and its branch, and states the platform won't merge for it", () => {
  const text = featureBranchPreamble("f1");
  assert.match(text, /feature "Invoice approval"/);
  assert.match(text, /`feature\/invoice-approval`/);
  assert.match(text, /will not merge/);
});

test("degrades to silence when the feature is gone", () => {
  // `featureId`'s FK is `set null` — a task can briefly carry a ref to a deleted feature
  // between the delete and that update landing. Naming a branch that no longer means
  // anything would be worse than saying nothing.
  assert.equal(featureBranchPreamble("f_does_not_exist"), "");
});
