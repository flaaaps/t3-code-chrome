import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

/**
 * The content script as one self-contained file. The crx build loads its content script through
 * `import()` from web-accessible chunks, which only works on the hosts listed in the manifest. GitHub
 * Enterprise Server hosts are added at runtime (`chrome.scripting.registerContentScripts`), so they
 * get this bundle instead, which needs no web-accessible resources.
 */
export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: "src/content/index.ts",
      formats: ["iife"],
      name: "t3CodeChromeContent",
      fileName: () => "content-standalone.js",
    },
  },
});
