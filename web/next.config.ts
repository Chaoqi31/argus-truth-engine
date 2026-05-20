import type { NextConfig } from "next";

const ARGUS_API_HOST = process.env.ARGUS_API_HOST ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/argus/:path*", destination: `${ARGUS_API_HOST}/:path*` },
    ];
  },
};

export default nextConfig;
