/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// The web app always calls the relative path /api. In dev, Vite forwards /api to
// VITE_API_URL (the backend). With VITE_API_URL unset, the in-browser mock adapter is used.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.VITE_API_URL;
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5176,
      strictPort: true,
      // The library's own files live in reads/; editing a book must not reload the app.
      watch: { ignored: ["**/reads/**"] },
      proxy: apiUrl ? { "/api": { target: apiUrl, changeOrigin: true } } : undefined,
    },
    preview: { port: 5176, strictPort: true },
    // One small app chunk (~175 kB gzipped, seed texts included); not worth splitting yet.
    build: { chunkSizeWarningLimit: 700 },
    test: {
      environment: "happy-dom",
      include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    },
  };
});
