import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy the WebSocket + API calls to the FastAPI backend (port 8000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8000", ws: true },
      "/health": "http://localhost:8000",
      "/upload": "http://localhost:8000",
    },
  },
});
