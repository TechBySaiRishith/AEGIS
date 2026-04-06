import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@aegis/shared"],

  // Proxy /api requests to the Hono backend so everything runs on one port
  async rewrites() {
    const apiUrl = process.env.API_INTERNAL_URL || "http://localhost:3001"; // single source: also in lib/env.server.ts
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },

  webpack: (config) => {
    // Resolve .js extensions to .ts for ESM-style imports in shared package
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
