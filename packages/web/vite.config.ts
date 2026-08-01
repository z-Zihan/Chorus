import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3210",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3210",
        ws: true,
      },
    },
  },
  // Ensure clear separation between Tauri and web builds
  build: {
    outDir: "dist",
  },
});
