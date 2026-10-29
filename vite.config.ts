import { fileURLToPath } from "node:url";
import { crx } from "@crxjs/vite-plugin";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@background": fileURLToPath(new URL("./src/background", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        options: "src/options/index.html",
      },
    },
  },
  server: {
    port: 5178,
    strictPort: true,
    hmr: { port: 5178 },
  },
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
  },
});
