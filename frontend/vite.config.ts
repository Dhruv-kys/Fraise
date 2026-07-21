import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
      "/artifacts": "http://localhost:8000",
      "/history": "http://localhost:8000",
      "/auth": "http://localhost:8000",
      "/agents": {
        target: "http://localhost:8000",
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["cache-control"] = "no-cache, no-transform";
          });
        },
      },
    },
  },
});
