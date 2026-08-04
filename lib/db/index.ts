import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DATA_DIR } from "../config";
import * as schema from "./schema";

// `PLATFORM_DB` points at one file (the test suite builds a throwaway DB with it);
// `PLATFORM_DATA_DIR`, via DATA_DIR, moves the whole data directory, which is how an installed
// app keeps its database outside the app folder that updates replace.
const DB_PATH = process.env.PLATFORM_DB ?? resolve(DATA_DIR, "platform.db");

declare global {
  var __platformSqlite: Database.Database | undefined;
}

function createConnection(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

// Reuse a single connection across Next.js hot reloads / the daemon process.
const sqlite = globalThis.__platformSqlite ?? createConnection();
if (process.env.NODE_ENV !== "production") globalThis.__platformSqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema };
