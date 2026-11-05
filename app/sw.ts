/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";
import { defaultCache } from "@serwist/next/worker";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Health data must never be stored by the service worker: Gnani routes (/api/gnani/*: TTS audio,
// manifests, status) and the public mother links (/listen/<token>/... pages and audio, the token is
// in the URL). Serwist matches runtimeCaching entries in array order and the first match wins, and
// defaultCache would otherwise cache these (its "/api/" GET rule is NetworkFirst, any other
// same-origin GET falls into the "others" NetworkFirst cache), so this rule MUST stay first.
const neverCache = {
  matcher: ({ url }: { url: URL }) =>
    url.pathname.startsWith("/api/gnani/") || url.pathname === "/listen" || url.pathname.startsWith("/listen/"),
  handler: new NetworkOnly(),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [neverCache, ...defaultCache],
  // Show a minimal offline notice for navigations that miss cache — this is
  // a staff tool for spotty clinic connectivity, not a fully offline app.
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
