import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "T3 Code for GitHub",
  description: pkg.description,
  // CI sets EXTENSION_VERSION per release (major.minor from package.json, patch = run number).
  version: process.env.EXTENSION_VERSION ?? pkg.version,
  icons: {
    16: "public/icons/icon-16.png",
    32: "public/icons/icon-32.png",
    48: "public/icons/icon-48.png",
    128: "public/icons/icon-128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_title: "T3 Code",
    default_icon: {
      16: "public/icons/icon-16.png",
      32: "public/icons/icon-32.png",
    },
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://github.com/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  permissions: ["storage", "alarms", "identity", "notifications", "contextMenus", "declarativeNetRequest"],
  host_permissions: ["https://github.com/*", "http://127.0.0.1/*", "http://localhost/*"],
  optional_host_permissions: ["http://*/*", "https://*/*"],
  commands: {
    "open-panel": {
      suggested_key: { default: "Alt+Shift+T" },
      description: "Open the T3 Code panel on the current pull request",
    },
  },
  web_accessible_resources: [
    {
      resources: ["public/icons/*.png"],
      matches: ["https://github.com/*"],
    },
  ],
});
