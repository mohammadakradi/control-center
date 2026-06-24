import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; don't bundle it into the server build.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
