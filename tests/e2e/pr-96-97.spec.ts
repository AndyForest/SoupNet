import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { BACKEND_URL, FRONTEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, type SeededUser } from "./helpers/accounts";
import { axeScan, shot } from "./helpers/evidence";

// Browser verification for SoupNet #96 and #97.
// Contract: claimNet docs/working/browser-verification/2026-09-27-pr96-pr97/expectations.md
// One test per expectation; screenshot names are fixed by that file.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const NO_DAILY_READS = /No recipe book is included in daily reads yet/;

// ── fixture helpers (API only where the expectations allow it) ─────────────

let recipeSeq = 0;

/** Create one recipe (a recipe check) through the API, written to `bookId` when given. */
async function addRecipe(request: APIRequestContext, user: SeededUser, recipe: string, bookId?: string): Promise<string> {
  const keyRes = await request.post(`${BACKEND_URL}/keys/daily`, {
    headers: asUser(user),
    data: bookId ? { writeRecipeBookId: bookId, label: "e2e fixture" } : { label: "e2e fixture" },
  });
  const keyJson = await keyRes.json();
  expect(keyJson.ok, `minting a fixture key for ${user.email} should succeed; got ${JSON.stringify(keyJson)}`).toBe(true);
  recipeSeq += 1;
  const evidence = `Fixture evidence for a browser verification run ${Date.now()}-${recipeSeq}\n> "the quick brown fox"\n-- e2e fixture`;
  const res = await request.get(`${BACKEND_URL}/check`, {
    params: { key: keyJson.data.key, trace: recipe, ef: evidence, format: "json" },
  });
  const body = await res.json();
  expect(res.ok() && body.ok, `creating a fixture recipe should succeed; got ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toBe(true);
  return body.data.recipeId as string;
}

async function bookIdByName(request: APIRequestContext, user: SeededUser, name: string): Promise<string> {
  const res = await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(user) });
  const json = await res.json();
  const book = (json.data as Array<{ id: string; name: string }>).find((b) => b.name === name);
  expect(book, `the book "${name}" should exist for ${user.email}`).toBeTruthy();
  return book!.id;
}

async function newActorPage(browser: Browser, user: SeededUser | null, path?: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    baseURL: FRONTEND_URL,
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  if (user) await signIn(page, user, path);
  return { ctx, page };
}

// ── UI helpers (drive the page as a person would) ──────────────────────────

function bookCard(page: Page, name: string): Locator {
  return page.locator("div.card").filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });
}

async function expandBook(page: Page, name: string): Promise<Locator> {
  const card = bookCard(page, name);
  await card.getByRole("heading", { level: 3, name, exact: true }).click();
  await expect(card.getByRole("heading", { level: 4, name: "Members" }), `expanding "${name}" should show its members`).toBeVisible();
  return card;
}

async function createBookInUi(page: Page, name: string): Promise<void> {
  await page.goto("/app/recipe-books");
  await page.getByRole("button", { name: "+ Create Recipe Book" }).click();
  await page.getByPlaceholder("Recipe book name").fill(name);
  await page.getByRole("button", { name: "Create Recipe Book", exact: true }).click();
  await expect(bookCard(page, name), `the new book "${name}" should appear on Recipe Books`).toBeVisible();
}

async function inviteInUi(page: Page, bookName: string, email: string): Promise<void> {
  await page.goto("/app/recipe-books");
  const card = await expandBook(page, bookName);
  await card.getByLabel("Invite by email").fill(email);
  await card.getByRole("button", { name: "Send invite" }).click();
  await expect(card.getByText(`Invited ${email}.`), "sending an invite should confirm who was invited").toBeVisible();
}

async function acceptInUi(page: Page, bookName: string): Promise<void> {
  await page.goto("/app/recipe-books");
  await expect(page.getByText(/You've been invited to/), "the invitee should see the pending invitation on Recipe Books").toBeVisible();
  await page.getByRole("button", { name: "Accept" }).first().click();
  await page.goto("/app/recipe-books");
  await expect(bookCard(page, bookName), `after accepting, "${bookName}" should be in the invitee's Recipe Books`).toBeVisible();
}

async function activeKeysCount(page: Page): Promise<number> {
  await page.goto("/app/dashboard");
  const value = page.locator('a[href="/app/keys"]').filter({ hasText: "Active Keys" }).locator("p").nth(1);
  await expect(value, "the Active Keys count should load").toHaveText(/^\d+$/);
  return Number(await value.textContent());
}

async function untickAllDailyReads(page: Page, testInfo: TestInfo): Promise<void> {
  await page.goto("/app/recipe-books");
  await expect(page.getByRole("heading", { level: 1, name: "Recipe Books" })).toBeVisible();
  const names = await page.locator("div.card h3").allTextContents();
  const bookNames = names.filter((n) => n !== "Create a new recipe book");
  for (const name of bookNames) {
    const card = await expandBook(page, name);
    const reads = card.getByLabel("Include in reads");
    if (await reads.isChecked()) {
      // Controlled checkbox: it flips only after the save round-trips, so click and wait.
      await reads.click();
      await expect(reads, `"Include in reads" for "${name}" should stay unticked after the save`).not.toBeChecked();
    }
  }
  // X4: the unticked state survives a reload.
  await page.reload();
  for (const name of bookNames) {
    const card = await expandBook(page, name);
    await expect(card.getByLabel("Include in reads"), `after a reload, "${name}" should still be excluded from daily reads`).not.toBeChecked();
  }
  await shot(page, testInfo, "E2-00-books-all-unticked");
}

function dailyReadsAlert(scope: Page | Locator): Locator {
  return scope.getByRole("alert").filter({ hasText: NO_DAILY_READS });
}

async function expectDailyReadsError(scope: Page | Locator, where: string): Promise<void> {
  const alert = dailyReadsAlert(scope);
  await expect(alert, `${where} should show a message that no recipe book is included in daily reads`).toBeVisible({ timeout: 15_000 });
  await expect(
    alert.getByRole("link", { name: "Recipe Books page" }),
    `the no-daily-books message on ${where} should link to Recipe Books`,
  ).toHaveAttribute("href", "/app/recipe-books");
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function recordAxe(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const serious = await axeScan(page, testInfo, name);
  testInfo.annotations.push({ type: `axe ${name}`, description: serious.length ? serious.join(" | ") : "no serious/critical violations" });
}

async function attachConsole(testInfo: TestInfo, errors: string[]): Promise<void> {
  await testInfo.attach("console-errors.txt", { body: errors.join("\n") || "(none)", contentType: "text/plain" });
}

// ── E1 ──────────────────────────────────────────────────────────────────────

test("E1 Settings → Account explains what deletion keeps @mobile", async ({ page, request }, testInfo) => {
  const user = await seedUser(request, "e1");
  const errors = collectConsoleErrors(page);

  await test.step("open Settings → Account and find the deletion section", async () => {
    await signIn(page, user, "/app/settings/account");
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Delete account" }) });
    await expect(section, "Settings → Account should have a Delete account section").toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await shot(page, testInfo, testInfo.project.name === "mobile" ? "E1-02-settings-account-deletion-copy-mobile" : "E1-01-settings-account-deletion-copy");

    await expect(section, "the copy should say recipe books shared with other people are not deleted").toContainText(/Recipe books you share stay/);
    await expect(section, "the copy should say ownership of a shared book passes to another member").toContainText(
      /ownership passes to another owner, or else to the longest-standing admin or member/,
    );
    await expect(section, "the copy should say only the user's own content (recipes) is removed").toContainText(/the content you authored: recipes/);
    await expect(section, "the copy should say other people's recipes are kept").toContainText(/other people's recipes are kept/);
    await expect(page.getByRole("button", { name: "Delete my account…" }), "the delete button should be offered but not pressed").toBeVisible();
  });

  if (testInfo.project.name === "desktop") {
    await test.step("X1 axe scan of Settings → Account", async () => {
      await recordAxe(page, testInfo, "X1-settings-account");
    });
  }
  await attachConsole(testInfo, errors);
});

// ── E2 ──────────────────────────────────────────────────────────────────────

test("E2 daily-key buttons with no daily books show an error linking to Recipe Books", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop scenario; E2a runs on mobile in its own test");
  test.setTimeout(180_000);
  const user = await seedUser(request, "e2");
  const errors = collectConsoleErrors(page);
  let baseline = 0;

  await test.step("fixture: one recipe so the dashboard shows its sidebar buttons", async () => {
    await addRecipe(request, user, `As a browser verifier checking the daily-key error, I prefer a visible message so that a silent failure is caught ${Date.now()}`);
  });

  await test.step("untick 'Include in reads' on every book in the Recipe Books page", async () => {
    await signIn(page, user, "/app/recipe-books");
    await untickAllDailyReads(page, testInfo);
  });

  await test.step("X1 axe scan of Recipe Books", async () => {
    await recordAxe(page, testInfo, "X1-recipe-books");
  });

  await test.step("record the Active Keys count before pressing any button", async () => {
    baseline = await activeKeysCount(page);
  });

  await test.step("E2a dashboard: Copy agent briefing", async () => {
    await page.goto("/app/dashboard");
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Copy agent briefing" }).click();
    await expectDailyReadsError(sidebar, "the dashboard after Copy agent briefing");
    await shot(page, testInfo, "E2a-01-dashboard-briefing-error");
    const style = await dailyReadsAlert(sidebar).getByRole("link").evaluate((el) => {
      const s = getComputedStyle(el);
      const p = getComputedStyle(el.parentElement!);
      return `link color ${s.color}, text-decoration-line ${s.textDecorationLine}; surrounding text color ${p.color}`;
    });
    testInfo.annotations.push({ type: "E2 error link style", description: style });
  });

  await test.step("X1 axe scan of the dashboard in the E2 error state", async () => {
    await recordAxe(page, testInfo, "X1-dashboard-e2-error");
  });

  await test.step("E2b dashboard: Open recipe check page", async () => {
    await page.goto("/app/dashboard");
    const sidebar = page.locator("aside");
    let popupOpened = false;
    page.once("popup", () => { popupOpened = true; });
    await sidebar.getByRole("button", { name: "Open recipe check page" }).click();
    await expectDailyReadsError(sidebar, "the dashboard after Open recipe check page");
    expect(popupOpened, "no check page should open when no key can be minted").toBe(false);
    await shot(page, testInfo, "E2b-01-open-check-page-error");
  });

  await test.step("E2c connect page: Copy agent briefing", async () => {
    await page.goto("/info/connect");
    await page.getByRole("button", { name: /Web chatbots without MCP/ }).click();
    await page.getByRole("button", { name: "Copy agent briefing" }).click();
    await expectDailyReadsError(page, "the connect page after Copy agent briefing");
    await dailyReadsAlert(page).scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E2c-01-connect-page-error");
  });

  await test.step("E2d check page: key minted on load, then the agent-link button", async () => {
    await page.goto("/app/check");
    await expectDailyReadsError(page, "the check page on load");
    await page.getByRole("button", { name: "Go to daily recipe check link for agents" }).click();
    await expectDailyReadsError(page, "the check page after the agent-link button");
    await shot(page, testInfo, "E2d-01-check-page-error");
  });

  await test.step("E2e-01 Recipe Books card: Copy agent briefing", async () => {
    await page.goto("/app/recipe-books");
    const card = await expandBook(page, "Personal");
    await card.getByRole("button", { name: "Copy agent briefing" }).click();
    await expectDailyReadsError(card, "the Recipe Books card after Copy agent briefing");
    await shot(page, testInfo, "E2e-01-recipe-books-briefing-error");
  });

  await test.step("E2e-02 Recipe Books card: Open recipe check page", async () => {
    await page.goto("/app/recipe-books");
    const card = await expandBook(page, "Personal");
    await card.getByRole("button", { name: "Open recipe check page" }).click();
    await expectDailyReadsError(card, "the Recipe Books card after Open recipe check page");
    await shot(page, testInfo, "E2e-02-recipe-books-open-check-page-error");
  });

  await test.step("E2e-03 Recipe Map: Copy agent briefing", async () => {
    await page.goto("/app/map");
    const btn = page.getByRole("button", { name: /^Copy agent briefing/ });
    await expect(btn, "the Recipe Map should offer a Copy agent briefing button").toBeVisible();
    await expect(btn, "the map briefing button should be enabled once the map has data").toBeEnabled({ timeout: 20_000 });
    await btn.click();
    await expectDailyReadsError(page, "the Recipe Map after Copy agent briefing");
    await shot(page, testInfo, "E2e-03-recipe-map-briefing-error");
  });

  await test.step("E2e-04 API Keys: Generate Link", async () => {
    await page.goto("/app/keys");
    await page.getByRole("button", { name: "Generate Link" }).click();
    await expectDailyReadsError(page, "the API Keys page after Generate Link");
    await shot(page, testInfo, "E2e-04-api-keys-generate-link-error");
  });

  await test.step("no key was minted: Active Keys did not go up", async () => {
    const after = await activeKeysCount(page);
    expect(after, `Active Keys should stay at ${baseline} after every refused daily-key button`).toBe(baseline);
  });

  await test.step("X2 keyboard only: Tab to the error's Recipe Books link and press Enter", async () => {
    await page.goto("/app/dashboard");
    const sidebar = page.locator("aside");
    const button = sidebar.getByRole("button", { name: "Copy agent briefing" });
    await expect(button).toBeVisible();
    // Tab from the top of the page to the button, press Enter.
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await button.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "the dashboard's Copy agent briefing button should be reachable with Tab").toBe(true);
    await page.keyboard.press("Enter");
    const link = dailyReadsAlert(sidebar).getByRole("link", { name: "Recipe Books page" });
    await expect(link, "pressing Enter on the button should show the no-daily-books message").toBeVisible({ timeout: 15_000 });
    let focused = false;
    for (let i = 0; i < 80 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await link.evaluate((el) => el === document.activeElement);
    }
    expect(focused, "the error's Recipe Books link should be reachable with Tab").toBe(true);
    await shot(page, testInfo, "X2-01-link-focused");
    await page.keyboard.press("Enter");
    await expect(page, "pressing Enter on the focused link should open Recipe Books").toHaveURL(/\/app\/recipe-books$/);
  });

  await test.step("E2-90 following the link lands on Recipe Books", async () => {
    await page.goto("/app/dashboard");
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Copy agent briefing" }).click();
    await dailyReadsAlert(sidebar).getByRole("link", { name: "Recipe Books page" }).click();
    await expect(page, "the error's link should land on the Recipe Books page").toHaveURL(/\/app\/recipe-books$/);
    await expect(page.getByRole("heading", { level: 1, name: "Recipe Books" }), "the Recipe Books page should render").toBeVisible();
    await shot(page, testInfo, "E2-90-link-lands-on-recipe-books");
  });

  await attachConsole(testInfo, errors);
});

test("E2a dashboard briefing error at phone width @mobile", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the desktop run of E2a is inside the E2 test");
  test.setTimeout(120_000);
  const user = await seedUser(request, "e2a-mobile");
  const errors = collectConsoleErrors(page);

  await test.step("fixture: one recipe so the dashboard shows its sidebar buttons", async () => {
    await addRecipe(request, user, `As a browser verifier on a phone, I prefer the daily-key error to fit the screen so that the link is tappable ${Date.now()}`);
  });

  await test.step("untick 'Include in reads' on every book", async () => {
    await signIn(page, user, "/app/recipe-books");
    await untickAllDailyReads(page, testInfo);
  });

  await test.step("E2a dashboard: Copy agent briefing", async () => {
    await page.goto("/app/dashboard");
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Copy agent briefing" }).click();
    await expectDailyReadsError(sidebar, "the dashboard (mobile) after Copy agent briefing");
    await dailyReadsAlert(sidebar).scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E2a-01-dashboard-briefing-error-mobile");
    const box = await dailyReadsAlert(sidebar).boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box && box.x >= 0 && box.x + box.width <= vw, "the error message should fit inside the phone viewport").toBeTruthy();
  });

  await attachConsole(testInfo, errors);
});

test("E2e dashboard onboarding briefing button (zero-checks user) with no daily books", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only");
  const user = await seedUser(request, "e2e-onboard");
  await signIn(page, user, "/app/recipe-books");
  await test.step("untick 'Include in reads' on every book", async () => {
    await untickAllDailyReads(page, testInfo);
  });
  const baseline = await activeKeysCount(page);
  await test.step("pick an agent type on the zero-checks card and press Copy agent briefing", async () => {
    await page.goto("/app/dashboard");
    await expect(page.getByRole("heading", { name: "Connect your first AI agent" }), "a zero-checks user should see the onboarding card").toBeVisible();
    await page.getByRole("button", { name: /Web chatbots without MCP/ }).click();
    await page.getByRole("button", { name: "Copy agent briefing" }).click();
    await expectDailyReadsError(page, "the dashboard onboarding card");
    await shot(page, testInfo, "E2e-05-dashboard-onboarding-briefing-error");
  });
  expect(await activeKeysCount(page), "no key should be minted by the onboarding button").toBe(baseline);
});

// ── E3 ──────────────────────────────────────────────────────────────────────

test("E3 the same buttons work with the default daily-read settings", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only");
  test.setTimeout(180_000);
  const user = await seedUser(request, "e3");
  const errors = collectConsoleErrors(page);
  let baseline = 0;

  async function expectCopied(scope: Page | Locator, where: string) {
    await expect(scope.getByRole("button", { name: /Copied!/ }), `${where}: the briefing should be copied`).toBeVisible({ timeout: 15_000 });
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text.length, `${where}: the clipboard should hold the briefing text`).toBeGreaterThan(200);
    expect(text, `${where}: the copied briefing should carry the real key, not the placeholder`).not.toContain("YOUR_API_KEY");
  }

  await test.step("fixture: one recipe so the dashboard shows its sidebar buttons", async () => {
    await addRecipe(request, user, `As a browser verifier running the control case, I prefer buttons that work by default so that the error test means something ${Date.now()}`);
  });

  await signIn(page, user, "/app/dashboard");
  baseline = await activeKeysCount(page);

  await test.step("E3a dashboard: Copy agent briefing", async () => {
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Copy agent briefing" }).click();
    await expectCopied(sidebar, "dashboard");
    await expect(dailyReadsAlert(page), "no no-daily-books message should appear").toHaveCount(0);
    await shot(page, testInfo, "E3a-01-dashboard-briefing-ok");
  });

  await test.step("E3b dashboard: Open recipe check page", async () => {
    await page.goto("/app/dashboard");
    const popupPromise = page.waitForEvent("popup");
    await page.locator("aside").getByRole("button", { name: "Open recipe check page" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url(), "the check page should open with a key in its URL").toMatch(/\/check\?.*key=/);
    await expect(dailyReadsAlert(page), "no no-daily-books message should appear").toHaveCount(0);
    await shot(popup, testInfo, "E3b-01-open-check-page-ok");
    await popup.close();
  });

  await test.step("E3c connect page: Copy agent briefing", async () => {
    await page.goto("/info/connect");
    await page.getByRole("button", { name: /Web chatbots without MCP/ }).click();
    await page.getByRole("button", { name: "Copy agent briefing" }).click();
    await expectCopied(page, "connect page");
    await expect(dailyReadsAlert(page), "no no-daily-books message should appear").toHaveCount(0);
    await shot(page, testInfo, "E3c-01-connect-page-ok");
  });

  await test.step("E3d check page: key on load, then the agent-link button", async () => {
    const keyResp = page.waitForResponse((r) => r.url().endsWith("/keys/daily") && r.request().method() === "POST");
    await page.goto("/app/check");
    expect((await keyResp).status(), "the check page's on-load key should be minted").toBe(200);
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Go to daily recipe check link for agents" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url(), "the agent link should open the check page with a key").toMatch(/\/check\?.*key=/);
    await expect(dailyReadsAlert(page), "no no-daily-books message should appear").toHaveCount(0);
    await shot(page, testInfo, "E3d-01-check-page-ok");
    await shot(popup, testInfo, "E3d-02-check-page-agent-link-opened");
    await popup.close();
  });

  await test.step("E3e-01 Recipe Books card: Copy agent briefing and Open recipe check page", async () => {
    await page.goto("/app/recipe-books");
    const card = await expandBook(page, "Personal");
    await card.getByRole("button", { name: "Copy agent briefing" }).click();
    await expectCopied(card, "Recipe Books card");
    const popupPromise = page.waitForEvent("popup");
    await card.getByRole("button", { name: "Open recipe check page" }).click();
    const popup = await popupPromise;
    expect(popup.url(), "the Recipe Books card should open the check page with a key").toMatch(/\/check\?.*key=/);
    await popup.close();
    await expect(dailyReadsAlert(page), "no no-daily-books message should appear").toHaveCount(0);
    await shot(page, testInfo, "E3e-01-recipe-books-ok");
  });

  await test.step("E3e-02 Recipe Map: Copy agent briefing", async () => {
    await page.goto("/app/map");
    const btn = page.getByRole("button", { name: /^Copy agent briefing/ });
    await expect(btn, "the map briefing button should be enabled once the map has data").toBeEnabled({ timeout: 20_000 });
    await btn.click();
    await expectCopied(page, "Recipe Map");
    await shot(page, testInfo, "E3e-02-recipe-map-ok");
  });

  await test.step("E3e-03 API Keys: Generate Link", async () => {
    await page.goto("/app/keys");
    await page.getByRole("button", { name: "Generate Link" }).click();
    await expect(page.getByText(/^Expires:/), "Generate Link should show the new link with its expiry").toBeVisible();
    await expect(dailyReadsAlert(page), "no no-daily-books message should appear").toHaveCount(0);
    await shot(page, testInfo, "E3e-03-api-keys-ok");
  });

  await test.step("keys were minted: Active Keys went up", async () => {
    const after = await activeKeysCount(page);
    expect(after, "Active Keys should rise when the daily-key buttons succeed").toBeGreaterThan(baseline);
    testInfo.annotations.push({ type: "E3 Active Keys", description: `${baseline} → ${after}` });
  });

  await attachConsole(testInfo, errors);
});

// ── E4 ──────────────────────────────────────────────────────────────────────

test("E4 removing a member and adding one back still work", async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only");
  test.setTimeout(180_000);
  const owner = await seedUser(request, "e4-owner");
  const member = await seedUser(request, "e4-member");
  const bookName = `E4 shared book ${Date.now()}`;
  const errors = collectConsoleErrors(page);
  const b = await newActorPage(browser, member, "/app/recipe-books");

  await test.step("owner creates a book and invites the second user; they accept", async () => {
    await signIn(page, owner, "/app/recipe-books");
    await createBookInUi(page, bookName);
    await inviteInUi(page, bookName, member.email);
    await acceptInUi(b.page, bookName);
  });

  await test.step("owner sees the member listed", async () => {
    await page.goto("/app/recipe-books");
    const card = await expandBook(page, bookName);
    await expect(card.locator("li").filter({ hasText: member.email }), "the accepted member should be listed").toBeVisible();
    await shot(page, testInfo, "E4-01-members-before");
  });

  await test.step("owner removes the member, then reloads", async () => {
    const card = bookCard(page, bookName);
    await card.locator("li").filter({ hasText: member.email }).getByRole("button", { name: "Remove" }).click();
    // #99 adds a confirmation step ("Yes, remove {email}"). Confirm it when it
    // appears, so E4 runs before and after that lands; ui-followups.spec.ts
    // pins the confirmation itself.
    const confirm = page.getByRole("button", { name: `Yes, remove ${member.email}` });
    if (await confirm.waitFor({ timeout: 2_000 }).then(() => true, () => false)) await confirm.click();
    await expect(card.locator("li").filter({ hasText: member.email }), "the removed member should leave the list").toHaveCount(0);
    await page.reload();
    const card2 = await expandBook(page, bookName);
    await expect(card2.locator("li").filter({ hasText: owner.email }), "the owner should still be listed").toBeVisible();
    await expect(card2.locator("li").filter({ hasText: member.email }), "after a reload the removed member should not be listed").toHaveCount(0);
    await shot(page, testInfo, "E4-02-member-removed-after-reload");
  });

  await test.step("the removed user no longer has the book", async () => {
    await b.page.goto("/app/recipe-books");
    await expect(b.page.getByRole("heading", { level: 1, name: "Recipe Books" })).toBeVisible();
    await expect(bookCard(b.page, "Personal"), "the removed user's own book should still load").toBeVisible();
    await expect(bookCard(b.page, bookName), "the removed user's Recipe Books should no longer list the book").toHaveCount(0);
    await shot(b.page, testInfo, "E4-03-removed-user-books");
  });

  await test.step("owner invites them again and they accept", async () => {
    await inviteInUi(page, bookName, member.email);
    await acceptInUi(b.page, bookName);
  });

  await test.step("owner reloads: the member is listed with the role they were given", async () => {
    await page.reload();
    const card = await expandBook(page, bookName);
    const row = card.locator("li").filter({ hasText: member.email });
    await expect(row, "after re-adding and a reload the member should be listed").toBeVisible();
    await expect(row, "the re-added member should hold the member role").toContainText("member");
    await shot(page, testInfo, "E4-04-member-readded-after-reload");
  });

  await test.step("the re-added user has the book again", async () => {
    await b.page.reload();
    await expect(bookCard(b.page, bookName), "the book should be back in the re-added user's Recipe Books").toBeVisible();
    await shot(b.page, testInfo, "E4-05-readded-user-books");
  });

  await b.ctx.close();
  await attachConsole(testInfo, errors);
});

// ── E5 ──────────────────────────────────────────────────────────────────────

test("E5 the last owner cannot leave or remove themselves (open)", async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only");
  test.setTimeout(120_000);
  const owner = await seedUser(request, "e5-owner");
  const member = await seedUser(request, "e5-member");
  const bookName = `E5 shared book ${Date.now()}`;
  const b = await newActorPage(browser, member, "/app/recipe-books");

  await test.step("owner creates a shared book with one other member", async () => {
    await signIn(page, owner, "/app/recipe-books");
    await createBookInUi(page, bookName);
    await inviteInUi(page, bookName, member.email);
    await acceptInUi(b.page, bookName);
  });

  await test.step("owner looks for a way to remove themselves or leave", async () => {
    await page.goto("/app/recipe-books");
    const card = await expandBook(page, bookName);
    const ownerRow = card.locator("li").filter({ hasText: owner.email });
    await expect(ownerRow, "the owner should be listed").toBeVisible();
    const removeOnSelf = await ownerRow.getByRole("button").count();
    const leaveButtons = await page.getByRole("button", { name: /leave/i }).count();
    const leaveLinks = await page.getByRole("link", { name: /leave/i }).count();
    testInfo.annotations.push({
      type: "E5 observed",
      description: `buttons on the owner's own member row: ${removeOnSelf}; buttons named /leave/: ${leaveButtons}; links named /leave/: ${leaveLinks}`,
    });
    await shot(page, testInfo, "E5-01-last-owner-attempt");
  });

  await test.step("after a reload the owner is still listed", async () => {
    await page.reload();
    const card = await expandBook(page, bookName);
    await expect(card.locator("li").filter({ hasText: owner.email }), "the owner should still be listed after a reload").toContainText("owner");
    await shot(page, testInfo, "E5-02-after-reload");
  });

  await b.ctx.close();
});

// ── E6 ──────────────────────────────────────────────────────────────────────

test("E6 deleting an owner's account keeps a co-author's book and recipes", async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only");
  test.setTimeout(180_000);
  const a = await seedUser(request, "e6-owner");
  const bUser = await seedUser(request, "e6-coauthor");
  const bookName = `E6 shared book ${Date.now()}`;
  const aRecipe = `As an owner leaving the recipe book, I prefer my own recipes removed with my account so that nothing I wrote lingers ${Date.now()}`;
  const bRecipe = `As a co-author staying in the recipe book, I prefer my recipes kept after the owner leaves so that the book stays useful ${Date.now()}`;
  const errors = collectConsoleErrors(page);
  const b = await newActorPage(browser, bUser, "/app/recipe-books");
  let bookId = "";

  await test.step("A creates a book, invites B, B accepts", async () => {
    await signIn(page, a, "/app/recipe-books");
    await createBookInUi(page, bookName);
    await inviteInUi(page, bookName, bUser.email);
    await acceptInUi(b.page, bookName);
    bookId = await bookIdByName(request, a, bookName);
  });

  await test.step("fixture: one recipe by A and one by B in the book", async () => {
    await addRecipe(request, a, aRecipe, bookId);
    await addRecipe(request, bUser, bRecipe, bookId);
  });

  await test.step("B sees the book (member) and both recipes before", async () => {
    await b.page.goto("/app/recipe-books");
    await expect(bookCard(b.page, bookName).locator(".pill").first(), "B should hold the member role before").toHaveText("member");
    await b.page.goto(`/app/recipe-books/${bookId}/traces`);
    await expect(b.page.getByText(aRecipe), "B should see A's recipe before the deletion").toBeVisible();
    await expect(b.page.getByText(bRecipe), "B should see their own recipe before the deletion").toBeVisible();
    await shot(b.page, testInfo, "E6-01-coauthor-book-before");
  });

  await test.step("A deletes the account through Settings → Account", async () => {
    await page.goto("/app/settings/account");
    await page.getByRole("button", { name: "Delete my account…" }).click();
    await page.getByLabel("Confirm with your password:").fill(a.password);
    await shot(page, testInfo, "E6-02-delete-confirmation");
    await page.getByRole("button", { name: "Permanently delete" }).click();
    await expect(page, "after deleting, A should be sent to the login page").toHaveURL(/\/auth\/login/, { timeout: 20_000 });
    const token = await page.evaluate(() => localStorage.getItem("claimnet_token"));
    expect(token, "A's session token should be cleared").toBeNull();
    await shot(page, testInfo, "E6-03-after-delete-signed-out");
  });

  await test.step("A cannot sign in again", async () => {
    const fresh = await newActorPage(browser, null);
    await fresh.page.addInitScript(() => localStorage.setItem("cookie_notice_dismissed", "true"));
    await fresh.page.goto("/auth/login");
    await fresh.page.getByLabel("Email").fill(a.email);
    await fresh.page.getByLabel("Password").fill(a.password);
    await fresh.page.getByRole("button", { name: "Sign In" }).click();
    await expect(fresh.page.getByText(/invalid|incorrect|not found|failed/i).first(), "signing in as the deleted A should show an error").toBeVisible();
    await expect(fresh.page, "the deleted A should stay on the login page").toHaveURL(/\/auth\/login/);
    await shot(fresh.page, testInfo, "E6-03b-deleted-user-login-refused");
    await fresh.ctx.close();
  });

  await test.step("B still has the book, now as owner", async () => {
    await b.page.goto("/app/recipe-books");
    const card = bookCard(b.page, bookName);
    await expect(card, "B should still see the book after A's deletion").toBeVisible();
    await expect(card.locator(".pill").first(), "B should now own the book").toHaveText("owner");
    const card2 = await expandBook(b.page, bookName);
    await expect(card2.locator("li").filter({ hasText: a.email }), "A should no longer be a member").toHaveCount(0);
    await shot(b.page, testInfo, "E6-04-coauthor-book-after");
    const idAfter = await bookIdByName(request, bUser, bookName);
    expect(idAfter, "the book's id should be unchanged").toBe(bookId);
  });

  await test.step("B's recipe is still there; A's is gone", async () => {
    await b.page.goto(`/app/recipe-books/${bookId}/traces`);
    await expect(b.page.getByText(bRecipe), "B's recipe should remain in the book").toBeVisible();
    await expect(b.page.getByText(aRecipe), "A's recipe should be gone from the book").toHaveCount(0);
    await shot(b.page, testInfo, "E6-05-coauthor-recipes-after");
  });

  await b.ctx.close();
  await attachConsole(testInfo, errors);
});
