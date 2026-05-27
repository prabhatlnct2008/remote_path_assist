import type { NextConfig } from "next";

// Authenticated route prefixes. The `(app)` route group does not appear in the
// URL, so noindex is applied to the concrete path prefixes that live under it.
const PRIVATE_PATHS = ["/cases", "/admin"];

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@libsql/client", "libsql"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Patient content must never leak to search engines (BUILD.md §8).
      ...PRIVATE_PATHS.map((p) => ({
        source: `${p}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
      ...PRIVATE_PATHS.map((p) => ({
        source: p,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};

export default nextConfig;
