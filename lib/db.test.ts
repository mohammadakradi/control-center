/**
 * Spec for the shared db connection (`lib/db/index.ts`). The regression this protects against:
 * Next's parallel build workers all import lib/db (33+ route modules, directly or
 * transitively), so several race to create/WAL-convert a brand-new `platform.db` at once
 * during `next build` — without a busy_timeout, SQLite throws SQLITE_BUSY immediately instead
 * of waiting for the lock, aborting a fresh install or `control-center update` mid-build.
 *
 * The value asserted below is deliberately different from better-sqlite3's own implicit
 * default (5000ms) so this test actually catches the pragma being dropped, rather than passing
 * either way because the library default happens to cover it too.
 *
 * Runs against a throwaway SQLite file, never `data/platform.db`.
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "platform-db-busy-timeout-test-"));
const dbFile = join(root, "test.db");

// Point the shared connection at the throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;

let db: typeof import("./db").db;

before(async () => {
  ({ db } = await import("./db"));

  // Guard: if the env override ever stopped working, fail loudly rather than reading the
  // real database's connection.
  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);
});

test.after(() => {
  (db.$client as { close?: () => void }).close?.();
  rmSync(root, { recursive: true, force: true });
});

test("the connection sets an explicit busy_timeout above better-sqlite3's own default", () => {
  const busyTimeout = db.$client.pragma("busy_timeout", { simple: true }) as number;
  assert.ok(
    busyTimeout > 5000,
    `expected an explicit busy_timeout above the library default (5000ms), got ${busyTimeout}`,
  );
});
