import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// Mirrors lib/config.ts + lib/db so `db:push` can't target a different database than the app
// reads. It matters for an installed app, where the data directory lives outside the app
// folder (`PLATFORM_DATA_DIR=~/.control-center/data`) — without this, a manual push would
// helpfully create a second, empty database inside the app directory.
const url =
  process.env.PLATFORM_DB ??
  resolve(process.env.PLATFORM_DATA_DIR?.trim() || "./data", "platform.db");

export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
