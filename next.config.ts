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
  // Tailwind v4 ships as a Turbopack loader, not a PostCSS plugin. Without
  // this rule the `@import "tailwindcss"` and `@theme` at-rules in
  // globals.css are never compiled, so every utility class silently produces
  // no CSS and the app renders unstyled. (@tailwindcss/turbopack is in
  // devDependencies; there is no postcss.config on purpose.)
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;