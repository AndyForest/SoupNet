import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { BACKEND_URL, FRONTEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, type SeededUser } from "./helpers/accounts";
import { shot } from "./helpers/evidence";
import AxeBuilder from "@axe-core/playwright";

// Browser verification for SoupNet branch fix/ui-followups.
// Contract: claimNet docs/working/browser-verification/2026-09-27-ui-followups/expectations.md
// One test per expectation (U1–U7; U8 re-runs pr-96-97.spec.ts unchanged). Screenshot names are fixed by that file.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const NO_DAILY_READS = /No recipe book is included in daily reads yet/;

// ── fixture helpers (API only where the expectations allow it) ─────────────

let recipeSeq = 0;

async function addRecipe(request: APIRequestContext, user: SeededUser, recipe: string): Promise<string> {
  const keyRes = await request.post(`${BACKEND_URL}/keys/daily`, { headers: asUser(user), data: { label: "e2e fixture" } });
  const keyJson = await keyRes.json();
  expect(keyJson.ok, `minting a fixture key for ${user.email} should succeed; got ${JSON.stringify(keyJson)}`).toBe(true);
  recipeSeq += 1;
  const evidence = `Fixture evidence for a browser verification run ${Date.now()}-${recipeSeq}\n> "the quick brown fox"\n-- e2e fixture`;
  const res = await request.get(`${BACKEND_URL}/check`, { params: { key: keyJson.data.key, trace: recipe, ef: evidence, format: "json" } });
  const body = await res.json();
  expect(res.ok() && body.ok, `creating a fixture recipe should succeed; got ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toBe(true);
  return body.data.recipeId as string;
}

async function newActorPage(browser: Browser, user: SeededUser | null, path?: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: FRONTEND_URL, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (user) await signIn(page, user, path);
  return { ctx, page };
}

function note(testInfo: TestInfo, type: string, description: string): void {
  testInfo.annotations.push({ type, description });
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function attachConsole(testInfo: TestInfo, errors: string[]): Promise<void> {
  await testInfo.attach("console-errors.txt", { body: errors.join("\n") || "(none)", contentType: "text/plain" });
}

// ── UI helpers ─────────────────────────────────────────────────────────────

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

async function bookNames(page: Page): Promise<string[]> {
  await expect(page.getByRole("heading", { level: 1, name: "Recipe Books" })).toBeVisible();
  await expect(page.locator("div.card h3").first()).toBeVisible();
  const names = await page.locator("div.card h3").allTextContents();
  return names.filter((n) => n !== "Create a new recipe book");
}

/** Untick "Include in reads" on every book, waiting for each save, then reload and confirm. */
async function untickAllDailyReads(page: Page): Promise<void> {
  await page.goto("/app/recipe-books");
  const names = await bookNames(page);
  for (const name of names) {
    const card = await expandBook(page, name);
    const reads = card.getByLabel("Include in reads");
    if (await reads.isChecked()) {
      const saved = page.waitForResponse((r) => r.url().includes("/daily-prefs") && r.request().method() === "PUT");
      await reads.click();
      await saved;
      await expect(reads, `"Include in reads" for "${name}" should be unticked after the save`).not.toBeChecked();
    }
  }
  await page.reload();
  for (const name of names) {
    const card = await expandBook(page, name);
    await expect(card.getByLabel("Include in reads"), `after a reload, "${name}" should still be excluded from daily reads`).not.toBeChecked();
  }
}

function dailyReadsAlert(scope: Page | Locator): Locator {
  return scope.getByRole("alert").filter({ hasText: NO_DAILY_READS });
}

/** Computed style of a link and its parent, as a readable line. */
async function linkStyle(link: Locator): Promise<{ line: string; underline: boolean }> {
  return link.evaluate((el) => {
    const s = getComputedStyle(el);
    const p = getComputedStyle(el.parentElement!);
    return {
      line: `text-decoration-line ${s.textDecorationLine}, color ${s.color}; parent <${el.parentElement!.tagName.toLowerCase()}> color ${p.color}`,
      underline: s.textDecorationLine.includes("underline"),
    };
  });
}

async function focusStyle(link: Locator): Promise<string> {
  return link.evaluate((el) => {
    const s = getComputedStyle(el);
    return `focused=${document.activeElement === el}; outline ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}; box-shadow ${s.boxShadow}; text-decoration-line ${s.textDecorationLine}`;
  });
}

/** axe scan: attaches the JSON under the fixed name, records serious/critical and moderate lines. */
async function axeRecord(page: Page, testInfo: TestInfo, name: string): Promise<{ serious: string[]; moderate: string[] }> {
  const results = await new AxeBuilder({ page }).analyze();
  await testInfo.attach(`${name}-axe.json`, { body: JSON.stringify(results.violations, null, 2), contentType: "application/json" });
  const fmt = (v: (typeof results.violations)[number]) =>
    `${v.id} (${v.impact}, ${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"}): ${v.help} [${v.nodes.map((n) => n.target.join(" ")).join("; ")}]`;
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map(fmt);
  const moderate = results.violations.filter((v) => v.impact === "moderate" || v.impact === "minor").map(fmt);
  note(testInfo, `${name} serious/critical`, serious.length ? serious.join(" | ") : "none");
  note(testInfo, `${name} moderate/minor`, moderate.length ? moderate.join(" | ") : "none");
  return { serious, moderate };
}

// ── U1 ──────────────────────────────────────────────────────────────────────

test("U1 links inside text read as links", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop scenario");
  test.setTimeout(180_000);
  const user = await seedUser(request, "u1");
  const errors = collectConsoleErrors(page);

  await test.step("fixture: one recipe so the dashboard shows its sidebar", async () => {
    await addRecipe(request, user, `As a browser verifier checking link styles, I prefer links that look like links so that people can find them ${Date.now()}`);
  });

  await test.step("control: at rest, before the error state, the Recipe Books inline links", async () => {
    await signIn(page, user, "/app/recipe-books");
    await bookNames(page);
    await page.mouse.move(0, 0);
    const learn = page.getByRole("link", { name: /Learn about recipe format/ });
    const s = await linkStyle(learn);
    note(testInfo, "U1 'Learn about recipe format…' at rest", s.line);
    expect.soft(s.underline, "the 'Learn about recipe format…' link should be underlined at rest").toBe(true);
  });

  await test.step("reproduce the no-daily-books state: untick every book", async () => {
    await untickAllDailyReads(page);
  });

  await test.step("Recipe Books: the two 'manage API keys' links at rest", async () => {
    await page.goto("/app/recipe-books");
    const card = await expandBook(page, "Personal");
    await page.mouse.move(0, 0);
    const links = card.getByRole("link", { name: "manage API keys" });
    const n = await links.count();
    note(testInfo, "U1 'manage API keys' links in the Personal card", String(n));
    for (let i = 0; i < n; i++) {
      const s = await linkStyle(links.nth(i));
      note(testInfo, `U1 Recipe Books 'manage API keys' #${i + 1} at rest`, s.line);
      expect.soft(s.underline, `Recipe Books 'manage API keys' link #${i + 1} should be underlined at rest`).toBe(true);
    }
    await shot(page, testInfo, "U1-03-recipe-books-inline-links");
  });

  await test.step("Recipe Books card: Copy agent briefing shows the error; its link at rest", async () => {
    const card = bookCard(page, "Personal");
    await card.getByRole("button", { name: "Copy agent briefing" }).click();
    const alert = dailyReadsAlert(card);
    await expect(alert, "the Recipe Books card should show the no-daily-books error").toBeVisible({ timeout: 15_000 });
    await page.mouse.move(0, 0);
    const s = await linkStyle(alert.getByRole("link", { name: "Recipe Books page" }));
    note(testInfo, "U1 error link at rest (Recipe Books card)", s.line);
    expect.soft(s.underline, "the error's 'Recipe Books page' link on the Recipe Books card should be underlined at rest").toBe(true);
  });

  await test.step("dashboard: Copy agent briefing shows the error; its link at rest", async () => {
    await page.goto("/app/dashboard");
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Copy agent briefing" }).click();
    const alert = dailyReadsAlert(sidebar);
    await expect(alert, "the dashboard should show the no-daily-books error").toBeVisible({ timeout: 15_000 });
    await page.mouse.move(0, 0);
    const link = alert.getByRole("link", { name: "Recipe Books page" });
    const s = await linkStyle(link);
    note(testInfo, "U1 error link at rest (dashboard)", s.line);
    await shot(page, testInfo, "U1-01-daily-key-error-link");
    expect.soft(s.underline, "the error's 'Recipe Books page' link on the dashboard should be underlined at rest").toBe(true);
  });

  await test.step("keyboard: Tab from the button reaches the link with a visible focus indicator", async () => {
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Copy agent briefing" }).focus();
    await page.keyboard.press("Enter");
    const link = dailyReadsAlert(sidebar).getByRole("link", { name: "Recipe Books page" });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Tab");
    await expect(link, "one Tab from the button should focus the error's link").toBeFocused();
    const f = await focusStyle(link);
    note(testInfo, "U1 error link focused (dashboard)", f);
    await shot(page, testInfo, "U1-02-daily-key-error-link-focused");
    expect.soft(/outline (solid|auto|dotted|dashed)/.test(f) || !/box-shadow none/.test(f), "the focused link should show an outline or focus ring").toBe(true);
  });

  await test.step("dashboard sidebar: 'manage API keys' at rest", async () => {
    await page.mouse.move(0, 0);
    const link = page.locator("aside").getByRole("link", { name: "manage API keys" });
    await link.scrollIntoViewIfNeeded();
    const s = await linkStyle(link);
    note(testInfo, "U1 dashboard sidebar 'manage API keys' at rest", s.line);
    await shot(page, testInfo, "U1-04-dashboard-sidebar-link");
    expect.soft(s.underline, "the dashboard's sidebar 'manage API keys' link should be underlined at rest").toBe(true);
  });

  await test.step("over-reach guard: nav items and button-styled links keep no underline", async () => {
    const survey = async (where: string) => {
      await page.mouse.move(0, 0);
      const rows = await page.locator("a").evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => {
            const s = getComputedStyle(el);
            return {
              text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50),
              cls: el.getAttribute("class") ?? "",
              inNav: !!el.closest("nav"),
              underline: s.textDecorationLine.includes("underline"),
            };
          }),
      );
      const underlined = rows.filter((r) => r.underline);
      note(testInfo, `U1-05 underlined links on ${where}`, underlined.map((r) => `"${r.text}"${r.cls ? ` [class=${r.cls}]` : ""}${r.inNav ? " (in nav)" : ""}`).join(" | ") || "none");
      const bad = underlined.filter((r) => r.inNav || (r.cls && r.cls !== "active"));
      expect.soft(bad.map((r) => r.text), `no nav item or class-styled link on ${where} should be underlined at rest`).toEqual([]);
    };
    await page.goto("/app/dashboard");
    await expect(page.getByRole("main")).toBeVisible();
    await survey("the dashboard");
    await shot(page, testInfo, "U1-05-nav-unchanged");
    await page.goto("/app/recipe-books");
    await bookNames(page);
    await survey("Recipe Books");
    await page.goto("/app/settings/account");
    await expect(page.getByRole("heading", { name: "Account", level: 3, exact: true })).toBeVisible();
    await survey("Settings → Account");
  });

  await attachConsole(testInfo, errors);
});

// ── U2 + U3 ─────────────────────────────────────────────────────────────────

test("U2 no serious or critical axe violations on Settings, Recipe Books, dashboard", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop scenario");
  test.setTimeout(180_000);
  const user = await seedUser(request, "u2");
  const found: Record<string, string[]> = {};

  await test.step("fixture: one recipe so the dashboard shows its sidebar", async () => {
    await addRecipe(request, user, `As a browser verifier scanning accessibility, I prefer pages without serious violations so that everyone can use them ${Date.now()}`);
  });

  await test.step("axe: Settings → Account", async () => {
    await signIn(page, user, "/app/settings/account");
    await expect(page.getByRole("button", { name: "Delete my account…" })).toBeVisible();
    found["settings-account"] = (await axeRecord(page, testInfo, "U2-settings-account")).serious;
  });

  await test.step("axe: Recipe Books", async () => {
    await page.goto("/app/recipe-books");
    await bookNames(page);
    found["recipe-books"] = (await axeRecord(page, testInfo, "U2-recipe-books")).serious;
  });

  await test.step("axe: dashboard", async () => {
    await page.goto("/app/dashboard");
    await expect(page.locator("aside").getByRole("button", { name: "Copy agent briefing" })).toBeVisible();
    found["dashboard"] = (await axeRecord(page, testInfo, "U2-dashboard")).serious;
  });

  await test.step("axe: dashboard in the no-daily-books error state", async () => {
    await untickAllDailyReads(page);
    await page.goto("/app/dashboard");
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Copy agent briefing" }).click();
    await expect(dailyReadsAlert(sidebar), "the dashboard should be in the error state").toBeVisible({ timeout: 15_000 });
    found["dashboard-error"] = (await axeRecord(page, testInfo, "U2-dashboard-error")).serious;
  });

  for (const [pageName, serious] of Object.entries(found)) {
    expect.soft(serious, `${pageName} should have zero serious or critical axe violations`).toEqual([]);
  }
});

test("U3 account deletion buttons have enough contrast", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop scenario");
  const user = await seedUser(request, "u3");
  const colours = (loc: Locator) =>
    loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return `color ${s.color} on background ${s.backgroundColor}; class="${el.getAttribute("class") ?? ""}"`;
    });

  await test.step("the Delete my account… button at rest", async () => {
    await signIn(page, user, "/app/settings/account");
    const btn = page.getByRole("button", { name: "Delete my account…" });
    await btn.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    note(testInfo, "U3 'Delete my account…'", await colours(btn));
    await shot(page, testInfo, "U3-01-delete-account-button");
  });

  await test.step("the confirmation state's buttons", async () => {
    await page.getByRole("button", { name: "Delete my account…" }).click();
    await page.getByLabel("Confirm with your password:").fill(user.password);
    await page.mouse.move(0, 0);
    note(testInfo, "U3 'Permanently delete'", await colours(page.getByRole("button", { name: "Permanently delete" })));
    note(testInfo, "U3 'Cancel'", await colours(page.getByRole("button", { name: "Cancel" })));
    await shot(page, testInfo, "U3-02-delete-confirmation-buttons");
    const { serious } = await axeRecord(page, testInfo, "U3-delete-confirmation");
    expect.soft(serious.filter((s) => s.startsWith("color-contrast")), "the confirmation state should have no color-contrast violations").toEqual([]);
  });
});

// ── U4 ──────────────────────────────────────────────────────────────────────

test("U4 removing a member asks first", async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop scenario");
  test.setTimeout(180_000);
  const owner = await seedUser(request, "u4-owner");
  const member = await seedUser(request, "u4-member");
  const bookName = `U4 shared book ${Date.now()}`;
  const errors = collectConsoleErrors(page);
  const b = await newActorPage(browser, member, "/app/recipe-books");
  const row = (card: Locator) => card.locator("li").filter({ hasText: member.email });

  await test.step("owner creates a book and invites the member; they accept in the app", async () => {
    await signIn(page, owner, "/app/recipe-books");
    await createBookInUi(page, bookName);
    await inviteInUi(page, bookName, member.email);
    await acceptInUi(b.page, bookName);
  });

  await test.step("owner presses Remove: a confirmation names the member and the book", async () => {
    await page.goto("/app/recipe-books");
    const card = await expandBook(page, bookName);
    await row(card).getByRole("button", { name: "Remove" }).click();
    await expect(row(card), "pressing Remove once should not remove the member").toBeVisible();
    await expect(card.getByText(member.email + " from " + bookName, { exact: false }), "the confirmation should name the member and the book").toBeVisible();
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 40)}"` : "none";
    });
    note(testInfo, "U4 focus when the confirmation opens", focus);
    const confirmText = await row(card).innerText();
    note(testInfo, "U4 confirmation text", confirmText.replace(/\s+/g, " "));
    await shot(page, testInfo, "U4-01-remove-confirmation");
  });

  await test.step("Cancel, reload: still a member", async () => {
    const card = bookCard(page, bookName);
    await row(card).getByRole("button", { name: "Cancel" }).click();
    await expect(row(card).getByRole("button", { name: "Remove" }), "after Cancel the row should offer Remove again").toBeVisible();
    await page.reload();
    const card2 = await expandBook(page, bookName);
    await expect(row(card2), "after Cancel and a reload the member should still be listed").toBeVisible();
    await expect(row(card2), "the member should still hold the member role").toContainText("member");
    await shot(page, testInfo, "U4-02-after-cancel-reload");
    await b.page.goto("/app/recipe-books");
    await expect(bookCard(b.page, bookName), "after Cancel the member should still have the book").toBeVisible();
  });

  await test.step("Remove, confirm, reload: removed", async () => {
    const card = bookCard(page, bookName);
    await row(card).getByRole("button", { name: "Remove" }).click();
    const confirm = card.getByRole("group", { name: new RegExp(`Remove .* from `) });
    await confirm.getByRole("button", { name: "Remove" }).click();
    await expect(row(card), "confirming should remove the member from the list").toHaveCount(0);
    await page.reload();
    const card2 = await expandBook(page, bookName);
    await expect(card2.locator("li").filter({ hasText: owner.email }), "the owner should still be listed").toBeVisible();
    await expect(row(card2), "after confirming and a reload the member should not be listed").toHaveCount(0);
    await shot(page, testInfo, "U4-03-after-confirm-reload");
    await b.page.goto("/app/recipe-books");
    await expect(bookCard(b.page, "Personal")).toBeVisible();
    await expect(bookCard(b.page, bookName), "the removed member should no longer have the book").toHaveCount(0);
  });

  await b.ctx.close();
  await attachConsole(testInfo, errors);
});

// ── U5 ──────────────────────────────────────────────────────────────────────

test("U5 the sign-in page confirms an account deletion", async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop scenario");
  test.setTimeout(120_000);
  const user = await seedUser(request, "u5");

  await test.step("delete the account through Settings → Account", async () => {
    await signIn(page, user, "/app/settings/account");
    await page.getByRole("button", { name: "Delete my account…" }).click();
    await page.getByLabel("Confirm with your password:").fill(user.password);
    await page.getByRole("button", { name: "Permanently delete" }).click();
    await expect(page, "after deleting, the user should land on the sign-in page").toHaveURL(/\/auth\/login/, { timeout: 20_000 });
  });

  await test.step("the sign-in page says the account was deleted", async () => {
    note(testInfo, "U5 URL after deletion", page.url());
    await expect(page.getByText(/account (has been|was) deleted/i), "the sign-in page should say the account was deleted").toBeVisible();
    await shot(page, testInfo, "U5-01-signin-after-delete");
  });

  await test.step("signing in as the deleted account still fails", async () => {
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText(/invalid|incorrect|not found|failed/i).first(), "signing in as the deleted account should show an error").toBeVisible();
    await expect(page, "the deleted account should stay on the sign-in page").toHaveURL(/\/auth\/login/);
    const stillShown = await page.getByText(/account (has been|was) deleted/i).isVisible();
    note(testInfo, "U5 deletion notice still shown next to the sign-in error", String(stillShown));
  });

  await test.step("a plain visit to the sign-in page shows no deletion message", async () => {
    const fresh = await newActorPage(browser, null);
    await fresh.page.addInitScript(() => localStorage.setItem("cookie_notice_dismissed", "true"));
    await fresh.page.goto("/auth/login");
    await expect(fresh.page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await expect(fresh.page.getByText(/deleted/i), "a plain sign-in page should not mention a deletion").toHaveCount(0);
    await shot(fresh.page, testInfo, "U5-02-signin-plain");
    await fresh.ctx.close();
  });
});

// ── U6 ──────────────────────────────────────────────────────────────────────

test("U6 Settings works at phone width @mobile", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone layout: mobile project only");
  const user = await seedUser(request, "u6");
  const pages = [
    { path: "/app/settings/account", name: "U6-01-settings-account-mobile", heading: "Account" },
    { path: "/app/settings/briefings", name: "U6-02-briefings-mobile", heading: null as string | null },
  ];
  await signIn(page, user, "/app/settings/account");

  await test.step("the Settings nav's items", async () => {
    const nav = page.getByRole("navigation", { name: "Settings" });
    await expect(nav).toBeVisible();
    const items = await nav.getByRole("link").allTextContents();
    note(testInfo, "U6 Settings nav items", items.join(", "));
  });

  for (const p of pages) {
    await test.step(`${p.path} at ${page.viewportSize()?.width}px`, async () => {
      await page.goto(p.path);
      const nav = page.getByRole("navigation", { name: "Settings" });
      await expect(nav).toBeVisible();
      await expect(page.locator(".card").first()).toBeVisible();
      if (p.heading) await expect(page.getByRole("heading", { level: 3, name: p.heading, exact: true })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const m = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Settings"]')!.getBoundingClientRect();
        const firstCard = document.querySelector(".card")!.getBoundingClientRect();
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          navBottom: nav.bottom,
          navRight: nav.right,
          cardTop: firstCard.top,
          cardLeft: firstCard.left,
          cardWidth: firstCard.width,
        };
      });
      note(testInfo, `U6 ${p.path}`, JSON.stringify(m));
      await shot(page, testInfo, p.name);
      expect.soft(m.scrollWidth, `${p.path} should not overflow horizontally`).toBeLessThanOrEqual(m.clientWidth);
      expect.soft(m.navBottom, `${p.path}: the Settings nav should sit above the content`).toBeLessThanOrEqual(m.cardTop);
      if (p.path.endsWith("/account")) {
        expect.soft(m.cardWidth, "the Account card should be at least most of the viewport wide").toBeGreaterThan(m.clientWidth * 0.5);
        const card = page.locator(".card").filter({ has: page.getByRole("heading", { level: 3, name: "Account", exact: true }) });
        const cb = (await card.boundingBox())!;
        const sb = (await card.getByRole("button", { name: "Sign out" }).boundingBox())!;
        note(testInfo, "U6 Account card box / Sign out box", `${JSON.stringify(cb)} / ${JSON.stringify(sb)}`);
        expect.soft(sb.x >= cb.x && sb.x + sb.width <= cb.x + cb.width + 0.5, "Sign out should sit inside the Account card").toBe(true);
      }
    });
  }
});

// ── U7 ──────────────────────────────────────────────────────────────────────

test("U7 include-in-reads and include-in-writes respond at once", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop scenario");
  test.setTimeout(120_000);
  const user = await seedUser(request, "u7");
  const isPut = (url: URL) => url.pathname.endsWith("/daily-prefs");

  await test.step("hold the save: the reads box flips before the response", async () => {
    await signIn(page, user, "/app/recipe-books");
    const card = await expandBook(page, "Personal");
    const reads = card.getByLabel("Include in reads");
    const before = await reads.isChecked();
    note(testInfo, "U7 reads before", String(before));

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let held = false;
    await page.route(isPut, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      held = true;
      await gate;
      await route.continue();
    });
    const response = page.waitForResponse((r) => isPut(new URL(r.url())) && r.request().method() === "PUT");
    await reads.click();
    await expect.poll(() => held, { message: "the save request should be in flight (held)" }).toBe(true);
    const instant = await reads.isChecked();
    await expect.soft(reads, "the box should flip on click, before the save returns (checked within 3 s while the save is still held)").toBeChecked({ checked: !before, timeout: 3000 });
    const during = await reads.isChecked();
    note(testInfo, "U7 reads while the save is held (same tick as the request / after up to 3 s)", `${instant} / ${during}`);
    await shot(page, testInfo, "U7-01-flipped-before-response");
    release();
    await response;
    await page.unroute(isPut);
    await expect(reads, "after the save returns the box should keep the new state").toBeChecked({ checked: !before });

    await page.reload();
    const card2 = await expandBook(page, "Personal");
    await expect(card2.getByLabel("Include in reads"), "after a reload the saved state should hold").toBeChecked({ checked: !before });
  });

  await test.step("hold the save: the writes box flips before the response too", async () => {
    const card = bookCard(page, "Personal");
    const writes = card.getByLabel("Include in writes");
    const before = await writes.isChecked();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let held = false;
    await page.route(isPut, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      held = true;
      await gate;
      await route.continue();
    });
    const response = page.waitForResponse((r) => isPut(new URL(r.url())) && r.request().method() === "PUT");
    await writes.click();
    await expect.poll(() => held).toBe(true);
    await expect.soft(writes, "the writes box should flip on click, before the save returns").toBeChecked({ checked: !before, timeout: 3000 });
    const during = await writes.isChecked();
    note(testInfo, "U7 writes before / while held", `${before} / ${during}`);
    release();
    await response;
    await page.unroute(isPut);
    // Put it back so the failure step starts from the default.
    const saved = page.waitForResponse((r) => isPut(new URL(r.url())) && r.request().method() === "PUT");
    await writes.click();
    await saved;
    await expect(writes).toBeChecked({ checked: before });
  });

  await test.step("a failed save reverts the box and shows an error", async () => {
    const card = bookCard(page, "Personal");
    const reads = card.getByLabel("Include in reads");
    const before = await reads.isChecked();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let during: boolean | null = null;
    await page.route(isPut, async (route) => {
      const req = route.request();
      if (req.method() !== "PUT") return route.continue();
      await gate;
      const origin = req.headers()["origin"] ?? FRONTEND_URL;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" },
        body: JSON.stringify({ ok: false, error: "Forced failure (e2e)" }),
      });
    });
    await reads.click();
    await expect.soft(reads, "the box should flip on click while the failing save is held").toBeChecked({ checked: !before, timeout: 3000 });
    during = await reads.isChecked();
    note(testInfo, "U7 failure: before / while held", `${before} / ${during}`);
    release();
    await expect(reads, "after the failed save the box should return to its previous state").toBeChecked({ checked: before });
    const alert = card.getByRole("alert");
    await expect(alert, "a failed save should show an error message").toBeVisible();
    note(testInfo, "U7 failure message", (await alert.innerText()).trim());
    await shot(page, testInfo, "U7-02-failed-save-reverted");
    await page.unroute(isPut);

    await page.reload();
    const card2 = await expandBook(page, "Personal");
    await expect(card2.getByLabel("Include in reads"), "after a reload the server state should be the pre-failure state").toBeChecked({ checked: before });
  });
});
