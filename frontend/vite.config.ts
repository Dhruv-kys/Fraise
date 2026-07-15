import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy the WebSocket + API calls to the FastAPI backend (port 8000).
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8000", ws: true },
      "/health": "http://localhost:8000",
      "/upload": "http://localhost:8000",
      "/dictate": "http://localhost:8000",
      // EVERY backend route must be listed here. An unlisted path doesn't 404 —
      // vite serves index.html with a cheerful 200, so fetch() gets HTML and the
      // feature silently does nothing. Add the route here when you add it to
      // main.py.
      "/artifacts": "http://localhost:8000",
      "/history": "http://localhost:8000",
      "/agents": {
        target: "http://localhost:8000",
        // SSE must not be buffered, or events arrive in one lump at the end —
        // which defeats the entire point of watching agents work.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["cache-control"] = "no-cache, no-transform";
          });
        },
      },
    },
  },
});
