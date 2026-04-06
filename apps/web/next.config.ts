import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@aegis/shared"],

  // Disable built-in gzip — it buffers SSE (text/event-stream) responses,
  // preventing real-time event delivery.  In production, compression should
  // be handled by a reverse proxy (nginx / Cloudflare) that can selectively
  // skip SSE routes.  See: https://nextjs.org/docs/app/api-reference/config/next-config-js/compress
  compress: false,

  // Proxy /api requests to the Hono backend so everything runs on one port
  async rewrites() {
    const port = process.env.PORT || "3001";
    const apiUrl = process.env.API_INTERNAL_URL || `http://localhost:${port}`;
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
