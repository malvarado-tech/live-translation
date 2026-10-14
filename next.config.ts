import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 blocks cross-origin requests to dev-only assets/endpoints by
  // default. Without the laptop's LAN IP listed here, phones on the same Wi-Fi
  // load the listener page HTML but the JS chunks return 403, so buttons appear
  // dead. Set ALLOWED_DEV_ORIGINS in .env.local (comma-separated hosts).
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export default nextConfig;
