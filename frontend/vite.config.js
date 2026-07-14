import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxying rather than CORS: the browser only ever talks to this dev
// server (localhost:5173), which forwards API calls to biographia_app
// server-side. Session cookies then look same-origin to the browser -
// no SameSite/CORS configuration needed on the Flask side at all.
export default defineConfig({
  plugins: [react()],
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
    proxy: {
      "/auth": "http://biographia_app:5000",
      "/whoami": "http://biographia_app:5000",
      "/profile": "http://biographia_app:5000",
      "/health": "http://biographia_app:5000",
      "/records": "http://biographia_app:5000",
      "/entities": "http://biographia_app:5000",
      "/users": "http://biographia_app:5000",
      "/attachments": "http://biographia_app:5000",
      "/logout": "http://biographia_app:5000",
      "/crypto": "http://biographia_app:5000",
      "/webauthn": "http://biographia_app:5000",
    },
  },
  build: {
    outDir: "dist",
  },
});
