import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  logLevel: "warn",
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
  server: { host: "127.0.0.1" },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
} as any);
