/**
 * Takes the README screenshots: real Chrome with the built extension, a public GitHub PR, and a fake
 * T3 server with demo data (see fakeT3.mjs). Nothing here talks to a real T3 install.
 *
 *   pnpm build && node test/e2e/showcase.mjs
 *
 * Output: docs/screenshots/*.png
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { DEMO_PR, startFakeT3 } from "./fakeT3.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distDir = path.join(root, "dist");
const outDir = path.join(root, "docs/screenshots");
const profileDir = path.join(root, "test/e2e/out/showcase-profile");
mkdirSync(outDir, { recursive: true });
rmSync(profileDir, { recursive: true, force: true });

const fake = await startFakeT3(3790);
const log = (step) => console.log(`▶ ${step}`);
const shot = (name) => path.join(outDir, `${name}.png`);
const pad = (box, padding, bounds) => {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  return {
    x,
    y,
    width: Math.min(bounds.width - x, box.width + padding * 2),
    height: Math.min(bounds.height - y, box.height + padding * 2),
  };
};
const union = (a, b) => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

const context = await chromium.launchPersistentContext(profileDir, {
  channel: "chromium",
  headless: true,
  deviceScaleFactor: 2,
  viewport: { width: 1280, height: 860 },
  colorScheme: "light",
  args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  log(`extension ${extensionId}`);

  // --- connect to the fake server and seed tracked sessions ----------------------------
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html#actions`);
  const connectionId = await options.evaluate(async (origin) => {
    const add = await chrome.runtime.sendMessage({ type: "connections.add", origin });
    if (!add.ok) throw new Error(add.error.message);
    const id = add.data.connection.id;
    const pair = await chrome.runtime.sendMessage({
      type: "connections.pairWithCode",
      id,
      code: "DEMO",
      access: "full-access",
    });
    if (!pair.ok) throw new Error(pair.error.message);
    return id;
  }, fake.origin);
  log("paired with fake T3");

  const pr = { host: DEMO_PR.host, owner: DEMO_PR.owner, repo: DEMO_PR.repo, number: DEMO_PR.number };
  const job = (threadId, threadTitle, status, minutes, extra = {}) => ({
    id: `job-${threadId}`,
    clientRequestId: `req-${threadId}`,
    pr,
    envKey: connectionId,
    threadId,
    threadTitle,
    link: `t3-thread://v2/demo-env-0001/${threadId}`,
    prompt: "…",
    startedAt: Date.now() - (minutes + 20) * 60_000,
    updatedAt: Date.now() - minutes * 60_000,
    status,
    ...extra,
  });
  await worker.evaluate(
    async ({ jobs, prUrl }) => {
      await chrome.storage.local.set({ jobs, settings: { lastPrUrl: prUrl } });
    },
    {
      prUrl: DEMO_PR.url,
      jobs: [
        job("t-review", "Review: leerer Workout-Screen nach Beenden", "waiting", 2, { branch: DEMO_PR.head }),
        job("t-ci", "CI fixen: live-activity.test.ts", "running", 1, { branch: DEMO_PR.head }),
        job("t-summary", "PR zusammenfassen", "completed", 55),
      ],
    },
  );

  // --- options: actions editor ------------------------------------------------------
  await options.setViewportSize({ width: 900, height: 1000 });
  await options.reload();
  await options.getByRole("button", { name: "Bearbeiten" }).first().click();
  const editor = options.locator(".card").first();
  await options.locator("pre.code").waitFor();
  await editor.screenshot({ path: shot("options-actions") });
  log("options-actions");
  await options.close();

  // --- popup: inbox -------------------------------------------------------------------
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 760 });
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await popup.getByText("Wartet auf dich").waitFor({ timeout: 20000 });
  await popup.locator(".quote.waiting").waitFor({ timeout: 20000 });
  await popup.getByRole("button", { name: /Heute fertig/ }).click();
  await popup.waitForTimeout(300);
  const popupBox = await popup.evaluate(() => {
    const rect = document.querySelector("#app")?.getBoundingClientRect();
    return rect ? { x: 0, y: 0, width: 388, height: rect.bottom + 12 } : undefined;
  });
  await popup.screenshot({ path: shot("popup-inbox"), clip: popupBox });
  log("popup-inbox");
  await popup.close();

  // --- PR page ------------------------------------------------------------------------
  const page = await context.newPage();
  await page.goto(DEMO_PR.url, { waitUntil: "domcontentloaded" });
  const header = page.locator("#t3-code-chrome-trigger");
  await header.locator(".t3-split.primary").waitFor({ timeout: 30000 });
  const box = page.locator("#t3-code-chrome-agentbox .t3-box");
  await box.locator(".t3-card").nth(2).waitFor({ timeout: 30000 });
  await box.locator(".t3-options").waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const viewport = page.viewportSize();
  const bounds = { width: viewport.width, height: viewport.height };

  const titleBox = await page.locator(".gh-header-title, h1").first().boundingBox();
  const agentBox = await box.boundingBox();
  const headerBox = await header.boundingBox();
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, (titleBox?.y ?? 0) - 24));
  await page.waitForTimeout(300);
  const scrollY = await page.evaluate(() => window.scrollY);
  const heroArea = union(union(titleBox, agentBox), headerBox);
  const hero = pad({ ...heroArea, y: heroArea.y - scrollY }, 20, bounds);
  await page.screenshot({ path: shot("pr-agent-box"), clip: hero });
  log("pr-agent-box");

  // header menu
  await header.locator(".t3-split > button").nth(1).click();
  const menu = header.locator(".t3-menu:not([hidden])");
  await menu.waitFor();
  await page.waitForTimeout(200);
  const menuArea = union(await menu.boundingBox(), await header.locator(".t3-header").boundingBox());
  await page.screenshot({ path: shot("pr-header-menu"), clip: pad(menuArea, 24, bounds) });
  log("pr-header-menu");
  await page.keyboard.press("Escape");

  // one-click countdown toast
  await header.locator(".t3-split > button").first().click();
  const toast = page.locator("#t3-code-chrome-host .t3-toast");
  await toast.waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot("toast-countdown"), clip: pad(await toast.boundingBox(), 16, bounds) });
  log("toast-countdown");
  await toast.getByRole("button", { name: "Abbrechen" }).click();

  // composer with target picker
  await header.locator(".t3-split > button").nth(1).click();
  await header.getByRole("menuitem", { name: "Anpassen…" }).click();
  const drawer = page.locator("#t3-code-chrome-host .t3-drawer");
  await drawer.locator(".t3-target").waitFor({ timeout: 20000 });
  await drawer
    .locator("textarea.t3-textarea")
    .first()
    .fill("Fokus auf den Offline-Fall und den Outbox-Flush. Live-Activity-Code nur überfliegen.");
  await drawer.locator(".t3-target").click();
  await drawer.locator(".t3-list").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("composer") });
  log("composer");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // composer started from a review comment (same path as the context menu / comment menu)
  const [tab] = await worker.evaluate(async () =>
    (await chrome.tabs.query({ url: "https://github.com/*" })).map((t) => t.id),
  );
  await worker.evaluate(
    async ({ tabId, selection }) =>
      chrome.tabs.sendMessage(tabId, { type: "panel.openWithSelection", selection }),
    {
      tabId: tab,
      selection:
        "Kannst du den Ladezustand auch für den Fall testen, dass die Outbox beim Beenden noch offline ist? Aktuell deckt der Test nur den Online-Pfad ab.",
    },
  );
  await drawer.locator(".t3-comment-quote").waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  const drawerBox = await drawer.boundingBox();
  await page.screenshot({ path: shot("composer-comment"), clip: drawerBox });
  log("composer-comment");

  console.log(`\nScreenshots written to ${path.relative(root, outDir)}/`);
} finally {
  await context.close();
  fake.close();
  rmSync(profileDir, { recursive: true, force: true });
}
