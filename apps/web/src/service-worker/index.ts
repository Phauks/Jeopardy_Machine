// PWA service worker skeleton (docs/decisions/2026-08-13-pwa.md). Caching policy, verbatim
// from the decision: precache hashed immutable build assets; NETWORK-FIRST for all HTML /
// navigation so nobody ever plays on a stale app shell. This file is deliberately minimal -
// the full asset story (fonts, sound packs, offline editor shell) grows in M4.
//
// Version-skew note: this SW never calls skipWaiting(), so an updated worker activates only
// once every tab from the old one is gone - a client mid-game is never hot-swapped. Protocol
// mismatches are additionally refused at the WS envelope (packages/protocol/src/envelope.ts).
//
// API note: SvelteKit 3 replaced the old `$service-worker` module with `$app/manifest`
// (build outputs / static files as `{ path }` objects) plus `$app/service-worker` (a
// correctly-typed `self`); the build version now comes from `$app/env`.
import { version } from "$app/env";
import { assets, immutable } from "$app/manifest";
import { self as serviceWorker } from "$app/service-worker";

// One cache per deployed version; activation deletes every older one.
const cacheName = `app-shell-${version}`;
// `immutable` = hashed JS/CSS emitted by Vite (empty during `vite dev` - the SW is a no-op
// shell there); `assets` = everything in static/ (icons, manifest). Both are safe to
// cache-first: a new deploy changes the URL (immutable) or the cache name (assets).
const precachedPaths = [...immutable, ...assets].map((entry) => entry.path);

serviceWorker.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(precachedPaths)));
});

serviceWorker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== cacheName).map((name) => caches.delete(name))),
      ),
  );
});

serviceWorker.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Navigations (HTML) are ALWAYS network-first: falling through to the browser's normal
  // fetch means no stale shell, ever. An offline fallback shell for the editor is an M4
  // feature; for now offline navigation fails honestly rather than faking availability.
  if (request.mode === "navigate") return;

  // Same-origin precached assets are cache-first: a hit is always correct (content-hashed or
  // version-keyed) and a miss falls through to the network.
  if (url.origin === serviceWorker.location.origin && precachedPaths.includes(url.pathname)) {
    event.respondWith(
      caches.open(cacheName).then(async (cache) => {
        const cached = await cache.match(request);
        return cached ?? fetch(request);
      }),
    );
  }
});
