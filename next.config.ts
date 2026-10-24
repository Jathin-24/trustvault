import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" }, // no clickjacking: the app cannot be framed
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Every page in this app is auth-gated and re-checks a live session + the
  // user's `active` flag on every request, so nothing is static. Turning
  // cacheComponents OFF (it is what caused the "Blocking Route" / "dynamic is
  // not compatible" build fights) makes that explicit: the (app) routes are
  // marked force-dynamic instead, which is the correct model for per-request
  // auth.
  cacheComponents: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;