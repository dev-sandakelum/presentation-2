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
  /* BrandLogo (headers, present chrome) renders /logo.png at quality 95 */
  images: {
    qualities: [75, 95],
  },
};

export default nextConfig;
