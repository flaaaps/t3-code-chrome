/**
 * End-to-end smoke test against a real Chrome with the built extension and the live local
 * T3 Code server. Usage:
 *
 *   pnpm build && node test/e2e/run.mjs [--pr https://github.com/owner/repo/pull/1] [--dispatch] [--headed]
 *
 * Requires: T3 Code desktop app running on 127.0.0.1:3773 and the `t3` CLI on PATH (or at ~/.t3/bin/t3)
 * to mint a pairing code. Screenshots land in test/e2e/out/.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distDir = path.join(root, "dist");
const outDir = path.join(root, "test/e2e/out");
mkdirSync(outDir, { recursive: true });
const prUrl = option("--pr", "https://github.com/flaaaps/pondus/pull/5");
const origin = option("--origin", "http://127.0.0.1:3773");
const t3Bin = process.env.T3_BIN ?? path.join(homedir(), ".t3/bin/t3");

function log(step, detail = "") {
  console.log(`▶ ${step}${detail ? ` ${detail}` : ""}`);
}

function mintPairingCode() {
  const json = execFileSync(
    t3Bin,
    ["auth", "pairing", "create", "--ttl", "10m", "--label", "t3-code-chrome e2e", "--json"],
    {
      encoding: "utf8",
    },
  );
  return JSON.parse(json).credential;
}

const userDataDir = path.join(outDir, "profile");
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: !flag("--headed"),
  args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
  viewport: { width: 1400, height: 1000 },
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  worker.on("console", (message) => console.log(`  [worker] ${message.type()}: ${message.text()}`));
  log("extension loaded", extensionId);

  // --- Options: add + pair ---------------------------------------------------
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await options.getByPlaceholder("http://127.0.0.1:3773").fill(origin);
  await options.getByRole("button", { name: "Hinzufügen" }).click();
  await options.getByText("Koppeln", { exact: true }).first().waitFor({ timeout: 15000 });
  log("server added");

  const code = mintPairingCode();
  await options.getByPlaceholder("Pairing-Code").fill(code);
  await options.getByRole("button", { name: "Koppeln", exact: true }).click();
  await options.locator(".status.connected, .alert.error").first().waitFor({ timeout: 30000 });
  if (await options.locator(".alert.error").count()) {
    throw new Error(`pairing failed: ${await options.locator(".alert.error").first().textContent()}`);
  }
  await options.screenshot({ path: path.join(outDir, "01-options-connected.png"), fullPage: true });
  log("paired and connected");

  // --- Popup ------------------------------------------------------------------
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await popup.locator(".status.connected").first().waitFor({ timeout: 10000 });
  await popup.screenshot({ path: path.join(outDir, "02-popup.png") });
  await popup.close();

  // --- GitHub PR page ----------------------------------------------------------
  const page = await context.newPage();
  await page.goto(prUrl, { waitUntil: "domcontentloaded" });
  const triggerHost = page.locator("#t3-code-chrome-trigger");
  await triggerHost.waitFor({ timeout: 30000 });
  log("trigger mounted");
  await page.screenshot({ path: path.join(outDir, "03-pr-with-trigger.png") });

  await triggerHost.locator("button.t3-trigger").click();
  const panel = page.locator("#t3-code-chrome-host .t3-panel");
  await panel.waitFor({ timeout: 10000 });
  await panel.locator("select.t3-select").first().waitFor({ timeout: 30000 });
  const projectSelect = panel.locator("select.t3-select").first();
  const selectedProject = await projectSelect.evaluate(
    (el) => el.options[el.selectedIndex]?.textContent ?? "",
  );
  log("panel open; preselected project:", selectedProject || "(none)");
  await page.screenshot({ path: path.join(outDir, "04-panel-new-session.png") });

  await panel.getByRole("button", { name: /Bestehende Session/ }).click();
  await panel.locator(".t3-threads, .t3-muted").first().waitFor({ timeout: 10000 });
  const threadCount = await panel.locator(".t3-thread").count();
  log("existing sessions listed:", String(threadCount));
  await page.screenshot({ path: path.join(outDir, "05-panel-existing-session.png") });

  await panel.getByRole("button", { name: /Neue Session/ }).click();
  await panel.getByRole("button", { name: "Freier Prompt" }).click();
  await panel
    .locator("textarea.t3-textarea")
    .first()
    .fill("Antworte ausschließlich mit dem Wort OK und beende dann.");
  await panel.locator("details.t3-details").last().locator("summary").click();
  const preview = await panel.locator("details.t3-details").last().locator("textarea").inputValue();
  if (!preview.includes(prUrl)) throw new Error(`prompt preview lacks PR url: ${preview}`);
  log("prompt preview ok");

  if (flag("--dispatch")) {
    await projectSelect.selectOption("__scratch__");
    await panel.getByRole("button", { name: "Session starten" }).click();
    await panel.locator(".t3-alert.success").waitFor({ timeout: 60000 });
    log("dispatched");
    await page.screenshot({ path: path.join(outDir, "06-dispatched.png") });
    await panel.locator(".t3-job .t3-status.completed").first().waitFor({ timeout: 180000 });
    await panel.getByRole("button", { name: "Letzte Antwort anzeigen" }).first().click();
    const reply = await panel.locator(".t3-job .reply").first().textContent();
    log("thread completed; reply:", (reply ?? "").trim().slice(0, 80));
    await page.screenshot({ path: path.join(outDir, "07-completed.png") });
  }

  console.log("\nE2E OK");
} finally {
  await context.close();
}
