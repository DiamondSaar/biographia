import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// All API prefixes this app calls (mirrors the proxy table below and the
// production nginx config) - the service worker must never cache these,
// this is live session/crypto data, not static content.
const API_PATHS = [
  "/auth",
  "/whoami",
  "/profile",
  "/health",
  "/records",
  "/entities",
  "/users",
  "/attachments",
  "/logout",
  "/crypto",
  "/webauthn",
];

// Proxying rather than CORS: the browser only ever talks to this dev
// server (localhost:5173), which forwards API calls to biographia_app
// server-side. Session cookies then look same-origin to the browser -
// no SameSite/CORS configuration needed on the Flask side at all.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pwa-192x192.png", "pwa-512x512.png", "maskable-512x512.png"],
      manifest: {
        name: "Biographia",
        short_name: "Biographia",
        lang: "ru",
        description: "Биография объектов и организаций ССОД",
        theme_color: "#1e293b",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache only the built app shell (JS/CSS/HTML/icons) - never
        // API responses. This is a live-data, session/crypto-sensitive
        // app, not a static site: a cache-first fallback could serve a
        // stale session state or wrong data with no indication it's
        // stale, so every API path below is NetworkOnly, not
        // NetworkFirst. A real offline write path is the separate
        // IndexedDB queue in src/offline/queue.js, not this cache.
        //
        // A RegExp literal here, not a closure function referencing
        // API_PATHS - generateSW serializes urlPattern via .toString()
        // into the built sw.js, and a function body keeps referencing
        // the outer `API_PATHS` identifier by name, which has no binding
        // in the service worker's own scope at runtime (ReferenceError
        // on the very first fetch). A RegExp's own .toString() is fully
        // self-contained, so it survives serialization correctly.
        navigateFallbackDenylist: API_PATHS.map((p) => new RegExp(`^${p}`)),
        runtimeCaching: [
          {
            urlPattern: new RegExp(`^(${API_PATHS.join("|")})`),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Same class of Host-header validation Django/boto3 already tripped
    // us up on this session (see biographia TZ section 13) - Vite's own
    // dev server rejects an unrecognized Host too. Dev-only server, never
    // runs in production, so wide open is fine here.
    allowedHosts: true,
    // Docker Desktop on Windows + bind-mounted volumes: inotify events
    // from host-side edits don't reliably reach the Linux container, so
    // Vite's file watcher can silently miss changes and keep serving a
    // stale transformed module - not a caching bug on the browser side,
    // the dev server itself never re-read the file. Polling sidesteps
    // that entirely at the cost of a bit of CPU.
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: Object.fromEntries(API_PATHS.map((p) => [p, "http://biographia_app:5000"])),
  },
  build: {
    outDir: "dist",
  },
});
