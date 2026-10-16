import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ["esbuild", "playwright-core"],
  allowedDevOrigins: ["10.161.79.82"],
};

export default nextConfig;
