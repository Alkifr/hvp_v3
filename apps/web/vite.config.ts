import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        timeout: 600_000,
        proxyTimeout: 600_000
      },
      "/health": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        timeout: 600_000,
        proxyTimeout: 600_000
      }
    }
  }
});

