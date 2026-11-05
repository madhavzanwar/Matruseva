import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// @serwist/next warns under `next dev --turbopack` even though it's already
// disabled outside production (disable below) — this is cosmetic, not a bug.
process.env.SERWIST_SUPPRESS_TURBOPACK_WARNING = "1";

const nextConfig: NextConfig = {
  // @serwist/next always injects a webpack() config (even when `disable` is
  // true below), which Next 16's Turbopack dev server otherwise flags as a
  // likely mistake. This acknowledges it's intentional.
  turbopack: {},
  experimental: {
    // Reuse dynamic pages from the client router cache for 30s so back/forth
    // taps are instant. Freshness after writes still holds: per the Next docs
    // (glossary "Client Cache", revalidatePath), revalidatePath/revalidateTag
    // in a Server Action, router.refresh(), and cookies.set/delete all purge
    // the client cache. All mutations here use those. Auth cookie changes
    // (login/logout) also purge it.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  async headers() {
    return [
      {
        source: "/:all*(svg|jpg|jpeg|png|webp|avif|ico|woff|woff2)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Public signed listen links: the token is in the URL, so keep it out of Referer, caches and indexes.
        // The page itself is never cached.
        source: "/listen/:token",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        // The counselling audio route sets its own Cache-Control (no-store for manifests and errors,
        // private + immutable for audio parts), so it is deliberately not given one here.
        source: "/listen/:token/audio",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  // The SW's offline fallback (app/sw.ts) serves /offline from the precache,
  // but it is a page route, not a public/ file, so it must be listed explicitly.
  additionalPrecacheEntries: [{ url: "/offline", revision: process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now()) }],
});

export default withSerwist(nextConfig);
