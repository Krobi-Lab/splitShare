import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Turns on offline connectivity detection plus automatic retry of blocked
    // navigation, prefetch and Server Action requests, and enables the
    // `useOffline` hook (which returns false without it). Worth having on a
    // phone app that gets used in a supermarket aisle.
    useOffline: true,
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          // Never cache the worker itself, or a bad one becomes permanent.
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
