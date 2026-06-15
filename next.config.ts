import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
  typescript: {
    // Tsc is run separately as `npm run typecheck` (backend strict mode).
    ignoreBuildErrors: false,
  },
};

export default config;
