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

  // --- PR list panels (/pulls) ------------------------------------------------------------
  // The real list page of the demo repo, signed in as the demo user, with the three searches the
  // panels run answered from demo data (the demo repo has no open PRs).
  const pullsUrl = `https://github.com/${DEMO_PR.owner}/${DEMO_PR.repo}/pulls`;
  const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const demoPr = (number, title, author, hours, extra = {}) => ({
    number,
    title,
    titleHtml: { value: title },
    author: { displayLogin: author },
    permalink: `${pullsUrl.replace(/pulls$/, "pull")}/${number}`,
    repoNameWithOwner: `${DEMO_PR.owner}/${DEMO_PR.repo}`,
    state: "REPO_PULL_REQUEST_STATE_OPEN",
    displayState: "REPO_PULL_REQUEST_DISPLAY_STATE_OPEN",
    createdAt: hoursAgo(hours + 30),
    updatedAt: hoursAgo(hours),
    commentCount: 0,
    ...extra,
  });
  const demoLists = {
    "author:@me": [
      demoPr(5, "fix(workout): kein leerer Screen nach Beenden der Live Activity", "flaaaps", 0.1, {
        commentCount: 4,
        labels: [{ name: "bug", color: "d73a4a" }],
      }),
      demoPr(4, "feat(mobile): Glocke am Pausenende über Kopfhörer", "flaaaps", 26, {
        labels: [{ name: "feature", color: "a2eeef" }],
      }),
      demoPr(9, "Live Activities: Spike für den Sperrbildschirm", "flaaaps", 72, { isDraft: true }),
      demoPr(11, "Glocke: Lautstärke folgt der Systemeinstellung", "flaaaps", 20),
      demoPr(12, "Glocke: Schalter in den Einstellungen", "flaaaps", 2, { commentCount: 1 }),
    ],
    "assignee:@me": [
      demoPr(4, "feat(mobile): Glocke am Pausenende über Kopfhörer", "flaaaps", 26, {
        labels: [{ name: "feature", color: "a2eeef" }],
      }),
      demoPr(6, "Offline-Outbox beim Beenden flushen", "lena-dev", 5, { commentCount: 2 }),
    ],
    "review-requested:@me": [
      demoPr(8, "Satzpausen-Timer im Sperrbildschirm", "tobi-k", 0.3, { commentCount: 1 }),
      demoPr(7, "Statistik: Wochenvolumen pro Muskelgruppe", "lena-dev", 4, {
        labels: [
          { name: "feature", color: "a2eeef" },
          { name: "ui", color: "c5def5" },
        ],
      }),
    ],
  };
  const embedded =
    /(<script type="application\/json" data-target="react-app\.embeddedData">)([\s\S]*?)(<\/script>)/;
  // Branches for the stack grouping: #4 ← #11 ← #12, everything else merges into main.
  const demoBranches = {
    4: ["main", "feat/bell"],
    11: ["feat/bell", "feat/bell-volume"],
    12: ["feat/bell-volume", "feat/bell-settings"],
    5: ["main", DEMO_PR.head],
  };
  await context.route(`https://github.com/${DEMO_PR.owner}/${DEMO_PR.repo}/pull/*/hovercard`, (route) => {
    const number = Number(new URL(route.request().url()).pathname.split("/").at(-2));
    const [base, head] = demoBranches[number] ?? ["main", `demo/pr-${number}`];
    const ref = (kind, branch) =>
      `<span id="${kind}-ref-${number}" class="commit-ref${kind === "base" ? " base-ref" : ""}"><span class="user">${DEMO_PR.owner}</span>:${branch}</span>`;
    return route.fulfill({
      contentType: "text/html",
      body: `<div class="tmp-p-3">${ref("base", base)}<span>&larr;</span>${ref("head", head)}</div>`,
    });
  });
  let pullsFetches = 0;
  await context.route(`${pullsUrl}*`, async (route) => {
    const response = await route.fetch();
    let body = (await response.text()).replace(
      /<meta name="user-login" content="[^"]*"/,
      `<meta name="user-login" content="${DEMO_PR.owner}"`,
    );
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    const role = Object.keys(demoLists).find((key) => query.includes(key));
    if (role) {
      pullsFetches += 1;
      const results = demoLists[role];
      body = body.replace(embedded, (_, open, json, close) => {
        const data = JSON.parse(json);
        data.payload.repoPullsDashboardContentRoute = {
          results,
          currentPage: 1,
          totalPages: 1,
          totalCount: results.length,
          openCount: results.length,
          closedCount: 0,
        };
        return `${open}${JSON.stringify(data)}${close}`;
      });
    }
    await route.fulfill({ response, body, headers: { ...response.headers(), "content-type": "text/html" } });
  });
  await worker.evaluate(async (pr) => {
    const { jobs } = await chrome.storage.local.get("jobs");
    await chrome.storage.local.set({
      pullsPanelsCollapsed: false,
      jobs: [
        ...jobs,
        {
          id: "job-t-timer",
          clientRequestId: "req-t-timer",
          pr: { ...pr, number: 8 },
          envKey: jobs[0].envKey,
          threadId: "t-timer",
          threadTitle: "Review: Satzpausen-Timer im Sperrbildschirm",
          link: "t3-thread://v2/demo-env-0001/t-timer",
          prompt: "…",
          startedAt: Date.now() - 20 * 60_000,
          updatedAt: Date.now() - 6 * 60_000,
          status: "running",
        },
      ],
    });
  }, pr);

  const list = await context.newPage();
  await list.setViewportSize({ width: 1280, height: 900 });
  await list.goto(pullsUrl, { waitUntil: "domcontentloaded" });
  const panelsHost = list.locator("#t3-code-chrome-pulls");
  await panelsHost.locator(".t3-prrow:not(.skeleton)").nth(4).waitFor({ timeout: 30000 });
  await panelsHost.locator(".t3-status.waiting").first().waitFor({ timeout: 20000 });
  await panelsHost.locator(".t3-stack-toggle").waitFor({ timeout: 20000 });
  if (pullsFetches < 3) throw new Error(`expected 3 list fetches, saw ${pullsFetches}`);
  await list.waitForTimeout(600);
  await list.screenshot({ path: path.join(root, "test/e2e/out/review/pulls-page.png") });
  const listBounds = list.viewportSize();
  const panelsBox = await panelsHost.locator(".t3-pulls").boundingBox();
  await list.evaluate((y) => window.scrollTo(0, y), Math.max(0, (panelsBox?.y ?? 0) - 24));
  await list.waitForTimeout(300);
  // Measured after scrolling, so the box is already in viewport coordinates.
  const panelsArea = await panelsHost.locator(".t3-pulls").boundingBox();
  await list.screenshot({ path: shot("pulls-panels"), clip: pad(panelsArea, 16, listBounds) });
  log("pulls-panels");

  // the stack, opened
  await panelsHost.locator(".t3-stack-toggle").click();
  await panelsHost.locator(".t3-prrow.stacked").nth(1).waitFor();
  await list.waitForTimeout(200);
  const mineBox = await panelsHost.locator(".t3-panel").nth(1).boundingBox();
  await list.screenshot({ path: shot("pulls-stack"), clip: pad(mineBox, 8, listBounds) });
  log("pulls-stack");
  await panelsHost.locator(".t3-stack-toggle").click();

  // row menu on the first review request (running session → "Session öffnen")
  const firstRow = panelsHost.locator(".t3-prrow").first();
  await firstRow.getByRole("button", { name: /Weitere Aktionen/ }).click();
  const rowMenu = firstRow.locator(".t3-menu:not([hidden])");
  await rowMenu.waitFor();
  await list.waitForTimeout(200);
  const rowMenuArea = union(await rowMenu.boundingBox(), await firstRow.boundingBox());
  await list.screenshot({ path: shot("pulls-row-menu"), clip: pad(rowMenuArea, 16, listBounds) });
  log("pulls-row-menu");
  await list.keyboard.press("Escape");

  // one-click from a row without a session: countdown names the PR, then cancel
  const reviewRow = panelsHost.locator(".t3-prrow").nth(1);
  await reviewRow.locator(".t3-split > button").first().click();
  const listToast = list.locator("#t3-code-chrome-host .t3-toast");
  await listToast.waitFor({ timeout: 30000 });
  const toastText = (await listToast.textContent()) ?? "";
  if (!toastText.includes("#7")) throw new Error(`countdown toast does not name the PR: ${toastText}`);
  await listToast.getByRole("button", { name: "Abbrechen" }).click();
  log("pulls one-click countdown ok");

  // review set: narrow and dark
  await list.setViewportSize({ width: 760, height: 900 });
  await list.waitForTimeout(400);
  await panelsHost
    .locator(".t3-pulls")
    .screenshot({ path: path.join(root, "test/e2e/out/review/pulls-narrow-760.png") });
  await list.emulateMedia({ colorScheme: "dark" });
  await list.setViewportSize({ width: 1280, height: 900 });
  await list.waitForTimeout(400);
  await panelsHost
    .locator(".t3-pulls")
    .screenshot({ path: path.join(root, "test/e2e/out/review/pulls-dark.png") });
  log("pulls review set");
  await list.close();

  console.log(`\nScreenshots written to ${path.relative(root, outDir)}/`);
} finally {
  await context.close();
  fake.close();
  rmSync(profileDir, { recursive: true, force: true });
}
