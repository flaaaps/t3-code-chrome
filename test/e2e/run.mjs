/**
 * End-to-end smoke test against a real Chrome with the built extension and the live local
 * T3 Code server. Usage:
 *
 *   pnpm build && node test/e2e/run.mjs [--pr https://github.com/owner/repo/pull/1] [--dispatch] [--headed]
 *
 * Requires: T3 Code desktop app running on 127.0.0.1:3773 and the `t3` CLI (default ~/.t3/bin/t3)
 * to mint a pairing code. Screenshots land in test/e2e/out/.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
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
const t3Bin = process.env.T3_BIN ?? path.join(homedir(), ".t3/bin/t3");

function log(step, detail = "") {
  console.log(`▶ ${step}${detail ? ` ${detail}` : ""}`);
}

function mintPairingCode() {
  const json = execFileSync(
    t3Bin,
    ["auth", "pairing", "create", "--ttl", "10m", "--label", "t3-code-chrome e2e", "--json"],
    { encoding: "utf8" },
  );
  return JSON.parse(json).credential;
}

const startedAt = new Date().toISOString();

/** Revoke the MCP client sessions this run paired, so T3's Connections list stays clean. */
function revokeTestSessions() {
  try {
    const sessions = JSON.parse(
      execFileSync(t3Bin, ["auth", "session", "list", "--json"], { encoding: "utf8" }),
    );
    for (const session of sessions) {
      if (session.client?.label === "T3 Code for GitHub (Chrome)" && session.issuedAt >= startedAt) {
        execFileSync(t3Bin, ["auth", "session", "revoke", session.sessionId], { stdio: "ignore" });
      }
    }
  } catch {
    // best effort
  }
}

const userDataDir = path.join(outDir, "profile");
if (!flag("--keep-profile")) rmSync(userDataDir, { recursive: true, force: true });
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
  worker.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.log(`  [worker] ${message.type()}: ${message.text()}`);
    }
  });
  log("extension loaded", extensionId);

  // --- Popup wizard: auto-detect + pair ------------------------------------------
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await popup.getByText("T3 Code gefunden auf 127.0.0.1:3773").waitFor({ timeout: 20000 });
  await popup.screenshot({ path: path.join(outDir, "01-popup-wizard.png") });
  log("local server detected");
  await popup.getByPlaceholder("Pairing-Code").fill(mintPairingCode());
  await popup.getByRole("button", { name: "Koppeln", exact: true }).click();
  await popup.locator(".alert.error, .muted:has-text('verbunden')").first().waitFor({ timeout: 30000 });
  if (await popup.locator(".alert.error").count()) {
    throw new Error(`pairing failed: ${await popup.locator(".alert.error").first().textContent()}`);
  }
  await popup.screenshot({ path: path.join(outDir, "02-popup-inbox.png") });
  log("paired via popup wizard");
  await popup.close();

  // --- Options ------------------------------------------------------------------
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html#actions`);
  await options.getByRole("button", { name: "Bearbeiten" }).first().click();
  await options.locator("pre.code").waitFor({ timeout: 5000 });
  await options.screenshot({ path: path.join(outDir, "03-options-actions-editor.png"), fullPage: true });
  await options.close();

  // --- GitHub PR page ----------------------------------------------------------
  const page = await context.newPage();
  await page.goto(prUrl, { waitUntil: "domcontentloaded" });
  const header = page.locator("#t3-code-chrome-trigger");
  await header.waitFor({ timeout: 30000 });
  await header.locator(".t3-split.primary").waitFor({ timeout: 30000 });
  const primaryLabel = (await header.locator(".t3-split > button").first().textContent())?.trim();
  log("header action ready:", primaryLabel);
  await page.screenshot({ path: path.join(outDir, "04-pr-header-action.png") });

  await header.locator(".t3-split > button").nth(1).click();
  await header.locator(".t3-menu:not([hidden])").waitFor({ timeout: 5000 });
  const menuTarget = (await header.locator(".t3-menu-target").textContent())?.trim();
  log("menu open;", menuTarget);
  await page.screenshot({ path: path.join(outDir, "05-pr-header-menu.png") });
  await header.getByRole("menuitem", { name: "Anpassen…" }).click();

  const drawer = page.locator("#t3-code-chrome-host .t3-drawer");
  await drawer.waitFor({ timeout: 10000 });
  await drawer.locator(".t3-target").waitFor({ timeout: 30000 });
  const target = (await drawer.locator(".t3-target .text").textContent())?.trim();
  log("composer open; target:", target);
  if (!/Pondus/.test(target ?? "")) throw new Error(`expected Pondus to be preselected, got: ${target}`);
  await page.screenshot({ path: path.join(outDir, "06-composer.png") });

  await drawer.locator(".t3-target").click();
  await drawer.locator(".t3-list").waitFor({ timeout: 5000 });
  const groups = await drawer.locator(".t3-list .group").allTextContents();
  log("target groups:", groups.join(" / "));
  await page.screenshot({ path: path.join(outDir, "07-composer-targets.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden", timeout: 5000 });

  // Free prompt requires text: button must say so.
  await header.locator(".t3-split > button").nth(1).click();
  await header.getByRole("menuitem", { name: "Freier Prompt" }).click();
  await drawer.waitFor({ timeout: 10000 });
  const footerButton = drawer.locator(".t3-drawer-foot .t3-btn.primary");
  const disabledLabel = (await footerButton.textContent())?.trim();
  if (!(await footerButton.isDisabled()) || !/Text fehlt/.test(disabledLabel ?? "")) {
    throw new Error(`free prompt should be blocked without text, button: ${disabledLabel}`);
  }
  log("free prompt blocked without text");
  await drawer
    .locator("textarea.t3-textarea")
    .first()
    .fill("Antworte ausschließlich mit dem Wort OK und beende dann.");
  await drawer.locator("details.t3-details summary").first().click();
  const preview = await drawer.locator("details.t3-details textarea").first().inputValue();
  if (!preview.includes(prUrl)) throw new Error(`prompt preview lacks PR url: ${preview}`);
  log("prompt preview ok");
  await page.screenshot({ path: path.join(outDir, "08-composer-free-prompt.png") });

  if (flag("--dispatch")) {
    await drawer.locator(".t3-target").click();
    await drawer.locator(".t3-list .opt", { hasText: "Ohne Projekt" }).click();
    await footerButton.click();
    const box = page.locator("#t3-code-chrome-agentbox .t3-box");
    await box.waitFor({ timeout: 60000 });
    log("dispatched; agent box visible");
    await page.screenshot({ path: path.join(outDir, "09-agent-box-running.png") });
    await box.locator(".t3-card .state.done").first().waitFor({ timeout: 180000 });
    const reply = (await box.locator(".t3-card .t3-quote").first().textContent())?.trim();
    log("session completed; reply:", (reply ?? "").slice(0, 80));
    await page.screenshot({ path: path.join(outDir, "10-agent-box-done.png") });
  }

  console.log("\nE2E OK");
} finally {
  await context.close();
  if (!flag("--keep-session")) revokeTestSessions();
}
