import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - PWA/SEO files (service worker, robots, sitemap) and static assets
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js$|swe-worker.*\\.js$|robots\\.txt$|sitemap\\.xml$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff|woff2)$).*)",
  ],
};
