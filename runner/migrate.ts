/**
 * `pnpm db:migrate` — apply pending schema migrations, then exit.
 *
 * Run by install.sh on a fresh install and by the `control-center` CLI before every start, so
 * an updated app never serves requests against an older schema. Safe to run repeatedly: with
 * nothing pending it snapshots the database, does nothing, and exits 0.
 *
 * This is the only supported way to change a real database. `pnpm db:push` diffs the schema
 * against the live database and is dev-only — see lib/db/migrate.ts.
 */
import { migrateDatabase } from "../lib/db/migrate";

const quiet = process.argv.includes("--quiet");
const log = (message: string) => {
  if (!quiet) console.log(message);
};

try {
  const outcome = migrateDatabase({ log });
  if (outcome.created) {
    log(`Created ${outcome.dbPath}`);
  }
  if (outcome.applied.length === 0 && !outcome.created) {
    log(`Schema is up to date (${outcome.dbPath})`);
  } else {
    log(`Migrated ${outcome.dbPath} — applied ${outcome.applied.length} migration(s)`);
  }
} catch (err) {
  console.error(`\nMigration failed.\n${(err as Error).message}\n`);
  process.exit(1);
}
