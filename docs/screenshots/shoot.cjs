// Retakes the README screenshots by driving a running dev server (npm run dev in tinefold-web/)
// through every screen with the demo provider. Uses the Chrome already on the machine.
//   npm i --no-save playwright-core   (in any folder; then run from there)
//   node shoot.cjs docs/screenshots [http://localhost:5173]
const path = require("path");
const { chromium } = require("playwright-core");

const out = process.argv[2];
const base = process.argv[3] || "http://localhost:5173";
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), animations: "disabled" });
const settle = (page, ms = 900) => page.waitForTimeout(ms);

async function createBrainstorm(page, statement) {
  await page.goto(`${base}/#/`);
  const ta = page.locator("textarea").first();
  await ta.waitFor();
  await ta.fill(statement);
  await page.getByRole("button", { name: "Start brainstorming" }).click();
  await page.waitForURL(/#\/g\//);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await settle(page, 600);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });

  // Desktop: 1440x900 @2x, like the existing screenshots.
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await desktop.newPage();

  await createBrainstorm(page, "How can we cut our AWS bill by half without slowing deploys? Two services dominate the spend.");
  await createBrainstorm(page, "We need search for our e-commerce catalog: about 2M products, updated hourly. We already run Elasticsearch for logs, and the team is four backend engineers.");

  // The bundled example: a real session with a root rewrite, reused branches and a comment.
  await page.goto(`${base}/#/`);
  await page.getByRole("button", { name: "Open the example" }).click();
  await page.waitForURL(/#\/g\//);
  const graphUrl = page.url();

  // Tree view.
  await page.evaluate(() => { localStorage.setItem("tinefold.view", "tree"); localStorage.setItem("tinefold.focus", "0"); });
  await page.reload();
  await page.getByRole("radio", { name: "Tree" }).waitFor();
  await page.getByText("adapter per provider").first().waitFor();
  await settle(page, 1200);
  await page.locator(".react-flow__controls-zoomout").click();
  await settle(page, 700);
  // Nudge the tree up so the bottom row clears the legend.
  await page.mouse.move(850, 450);
  await page.mouse.down();
  await page.mouse.move(850, 420, { steps: 4 });
  await page.mouse.move(850, 380, { steps: 4 });
  await page.mouse.up();
  await settle(page, 500);
  await shot(page, "tree");

  // Focus mode with the comments panel open.
  await page.getByRole("button", { name: "Focus" }).click();
  await page.getByRole("toolbar", { name: "Focus tools" }).waitFor();
  await settle(page, 1200);
  await page.locator(".react-flow__controls-zoomout").click();
  await settle(page, 700);
  await page.getByRole("button", { name: "Comments" }).click();
  await settle(page, 500);
  await shot(page, "focus");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { level: 1 }).waitFor();

  // Outline view.
  await page.getByRole("radio", { name: "Outline" }).click();
  await page.getByText("Solve all of these").first().waitFor();
  await settle(page, 600);
  await shot(page, "outline");

  // Document panel.
  await page.getByRole("button", { name: "Write a document" }).click();
  await page.getByRole("dialog").waitFor();
  await settle(page, 500);
  await shot(page, "documents");
  await page.keyboard.press("Escape");

  // Home with three brainstorms listed.
  await page.goto(`${base}/#/`);
  await page.getByText("Your brainstorms").waitFor();
  await page.getByText("[Example]").first().waitFor();
  await settle(page, 600);
  await shot(page, "home");
  await desktop.close();

  // Phone: separate context, so open the example again there.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light" });
  const p = await phone.newPage();
  await p.goto(`${base}/#/`);
  await p.getByRole("button", { name: "Open the example" }).click();
  await p.waitForURL(/#\/g\//);
  await p.getByText("The tree is for a desktop or tablet screen").waitFor();
  await settle(p, 600);
  await shot(p, "phone");
  await phone.close();

  await browser.close();
  console.log("done", graphUrl);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
