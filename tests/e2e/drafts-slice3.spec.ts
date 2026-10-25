import { expect, test, type APIRequestContext, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, signInNewContext, type SeededUser } from "./helpers/accounts";
import { assertNoHorizontalScroll, axeScan, horizontalOverflow, shot } from "./helpers/evidence";

// Drafts slice 3 (the review queue), verified against
// claimNet docs/working/browser-verification/2026-09-27-drafts-slice3/expectations.md.
// One test per expectation E1-E17. Fixtures go through the API (seeded
// accounts, books, keys, draft deposits through MCP check_recipe with
// draft=true); the steps under test go through the SPA.
// Regression test on main since the 2026-09-29 post-merge run (claimNet
// docs/working/browser-verification/2026-09-29-drafts-post-merge/results-regression.md).

const RUN = Date.now().toString(36);
let seq = 0;
const tag = (what: string) => `${what}-${RUN}-${++seq}`;

interface Actor extends SeededUser {
  userId: string;
  personalBookId: string;
  personalBookName: string;
  orgId: string;
}
interface Book {
  id: string;
  slug: string;
  name: string;
}

async function actor(request: APIRequestContext, label: string): Promise<Actor> {
  const u = await seedUser(request, label);
  const me = await (await request.get(`${BACKEND_URL}/auth/me`, { headers: asUser(u) })).json();
  const books = (await (await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(u) })).json()).data as Array<{
    id: string;
    name: string;
    organization_id: string;
  }>;
  return {
    ...u,
    userId: me.data?.user?.id ?? me.data?.id ?? "",
    personalBookId: books[0]!.id,
    personalBookName: books[0]!.name,
    orgId: books[0]!.organization_id,
  };
}

async function newBook(request: APIRequestContext, owner: Actor, label: string, members: Actor[]): Promise<Book> {
  const name = `${label} ${RUN}${++seq}`;
  const slug = `${label}-${RUN}${seq}`.toLowerCase();
  const res = await request.post(`${BACKEND_URL}/recipe-books`, {
    headers: asUser(owner),
    data: { name, slug, organizationId: owner.orgId },
  });
  const body = await res.json();
  expect(res.ok(), `creating book ${name} should succeed; got ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  for (const m of members) {
    const added = await request.post(`${BACKEND_URL}/recipe-books/${body.data.id}/members`, {
      headers: asUser(owner),
      data: { email: m.email, role: "member" },
    });
    expect(added.status(), `adding ${m.email} to ${name} should succeed`).toBe(201);
  }
  return { id: body.data.id, slug, name };
}

async function mintKey(request: APIRequestContext, who: Actor, books: string[], def: string, label: string): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/keys/scoped`, {
    headers: asUser(who),
    data: {
      readRecipeBookIds: books,
      writeRecipeBookIds: books,
      defaultWriteRecipeBookId: def,
      expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
      label,
    },
  });
  const body = await res.json();
  expect(res.ok(), `minting key ${label} should succeed; got ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  return body.data.key as string;
}

function recipeText(marker: string): string {
  return `As a backend maintainer working on the review queue (${marker}), I prefer drafts reviewed in one place so that nothing waits unseen.`;
}

/** Deposit through MCP check_recipe. Returns the recipe id. */
async function deposit(
  request: APIRequestContext,
  key: string,
  text: string,
  opts: { draft?: boolean; impact?: string; uncertainty?: string; book?: string; why?: string; cite?: string } = {},
): Promise<string> {
  const why = opts.why ?? "Could not ask: the person is away.";
  const ev = `${why}\n> "quote for ${text.slice(-30)}"\n-- ${opts.cite ?? "drafts-slice3.spec.ts"}`;
  const args: Record<string, unknown> = { recipe: text, supporting_evidence: ev, response_format: "structured" };
  if (opts.draft !== false) args["draft"] = true;
  if (opts.impact) args["impact"] = opts.impact;
  if (opts.uncertainty) args["uncertainty"] = opts.uncertainty;
  if (opts.book) args["recipe_book"] = opts.book;
  const res = await request.post(`${BACKEND_URL}/mcp`, {
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${key}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_recipe", arguments: args } },
  });
  const raw = await res.text();
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
  const msg = JSON.parse(line ? line.slice(6) : raw);
  const id = msg.result?.structuredContent?.checked?.recipeId as string | undefined;
  expect(id, `depositing "${text.slice(0, 60)}" should return a recipe id; got ${raw.slice(0, 300)}`).toBeTruthy();
  return id!;
}

/** Pat, Sam, the shared book (Sam owns), the quiet book (daily reads off), and Pat's two keys. */
async function cast(request: APIRequestContext, label: string) {
  const pat = await actor(request, `${label}-pat`);
  const sam = await actor(request, `${label}-sam`);
  const shared = await newBook(request, sam, `${label}-shared`, [pat]);
  const quiet = await newBook(request, sam, `${label}-quiet`, [pat]);
  const prefs = await request.put(`${BACKEND_URL}/recipe-books/${quiet.id}/daily-prefs`, {
    headers: asUser(pat),
    data: { dailyRead: false, dailyWrite: false },
  });
  expect(prefs.status(), "turning daily reads off for the quiet book should succeed").toBe(200);
  const keyALabel = `${label} key A ${RUN}`;
  const keyBLabel = `${label} key B ${RUN}`;
  const patKeyA = await mintKey(request, pat, [shared.id, quiet.id, pat.personalBookId], shared.id, keyALabel);
  const patKeyB = await mintKey(request, pat, [shared.id, quiet.id], quiet.id, keyBLabel);
  return { pat, sam, shared, quiet, patKeyA, patKeyB, keyALabel, keyBLabel };
}

const items = (page: Page) => page.getByTestId("queue-item");
const item = (page: Page, marker: string) => items(page).filter({ hasText: marker });
const totalLine = (page: Page) => page.getByTestId("queue-total");

async function itemTexts(page: Page): Promise<string[]> {
  return (await items(page).locator("p[id^='draft-']").allInnerTexts()).map((t) => t.trim());
}

async function openQueue(page: Page, path = "/app/drafts") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 }), "the queue page should render its heading").toBeVisible();
  await expect(page.getByText("Loading…"), "the queue should finish loading").toHaveCount(0);
}

// A second actor keeps the running project's device settings (shared helper).
async function newSignedInPage(browser: Browser, testInfo: TestInfo, user: SeededUser, path: string): Promise<Page> {
  return (await signInNewContext(browser, testInfo, user, path)).page;
}

function actionButtons(scope: Locator | Page) {
  return scope.getByRole("button", { name: /^(Confirm|Reject|Not chosen)/ });
}

// ──────────────────────────────────────────────────────────────────────────

test("E1 the queue lists Pat's unresolved drafts, from every book", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e1");
  const m = { shared: tag("e1shared"), quiet: tag("e1quiet"), personal: tag("e1personal") };
  await test.step("deposit one draft in each of Pat's three books, with two keys", async () => {
    await deposit(request, c.patKeyA, recipeText(m.shared), { book: c.shared.slug });
    await deposit(request, c.patKeyB, recipeText(m.quiet), { book: c.quiet.slug });
    await deposit(request, c.patKeyA, recipeText(m.personal), { book: c.pat.personalBookId });
  });
  await test.step("open /app/drafts", async () => {
    await signIn(page, c.pat, "/app/drafts");
    await openQueue(page);
    await expect(items(page), "all three drafts should be listed").toHaveCount(3);
    for (const k of Object.values(m)) await expect(item(page, k), `the draft ${k} should be listed`).toHaveCount(1);
    await expect(item(page, m.quiet), "the draft in the book with daily reads off should be listed").toContainText(c.quiet.name);
    testInfo.annotations.push({ type: "E1 items", description: (await itemTexts(page)).join(" | ") });
    await shot(page, testInfo, "E1-01-queue-three-books");
  });
  await test.step("reload", async () => {
    await page.reload();
    await openQueue(page, page.url());
    await expect(items(page), "after a reload the queue should still list three drafts").toHaveCount(3);
    await shot(page, testInfo, "E1-02-after-reload");
  });
});

test("E2 the queue lists nothing else", async ({ page, request, browser }, testInfo) => {
  const c = await cast(request, "e2");
  const samKey = await mintKey(request, c.sam, [c.shared.id], c.shared.id, `e2 sam key ${RUN}`);
  const m = { patDraft: tag("e2patdraft"), samDraft: tag("e2samdraft"), patPublished: tag("e2patpublished") };
  await test.step("Sam's key deposits a draft, Pat's key deposits a draft and a published recipe in the shared book", async () => {
    await deposit(request, samKey, recipeText(m.samDraft), { book: c.shared.slug });
    await deposit(request, c.patKeyA, recipeText(m.patDraft), { book: c.shared.slug });
    await deposit(request, c.patKeyA, recipeText(m.patPublished), { book: c.shared.slug, draft: false });
  });
  await test.step("Pat opens /app/drafts", async () => {
    await signIn(page, c.pat, "/app/drafts");
    await openQueue(page);
    await expect(item(page, m.patDraft), "Pat should see his own draft").toHaveCount(1);
    await expect(item(page, m.samDraft), "Pat should not see Sam's draft").toHaveCount(0);
    await expect(item(page, m.patPublished), "Pat should not see his published recipe in the queue").toHaveCount(0);
    testInfo.annotations.push({ type: "E2 Pat sees", description: (await itemTexts(page)).join(" | ") });
    await expect(items(page), "Pat's queue should hold exactly his one draft").toHaveCount(1);
    await shot(page, testInfo, "E2-01-pat-queue");
  });
  await test.step("Sam opens /app/drafts", async () => {
    const sp = await newSignedInPage(browser, testInfo, c.sam, "/app/drafts");
    await openQueue(sp);
    await expect(item(sp, m.samDraft), "Sam should see his own draft").toHaveCount(1);
    await expect(item(sp, m.patDraft), "Sam should never see Pat's draft").toHaveCount(0);
    await expect(item(sp, m.patPublished), "Sam should not see Pat's published recipe in the queue").toHaveCount(0);
    testInfo.annotations.push({ type: "E2 Sam sees", description: (await itemTexts(sp)).join(" | ") });
    await expect(items(sp), "Sam's queue should hold exactly his one draft").toHaveCount(1);
    await shot(sp, testInfo, "E2-02-sam-queue");
    await sp.context().close();
  });
});

test("E3 each item carries what triage needs", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e3");
  const m = { rated: tag("e3rated"), unrated: tag("e3unrated") };
  const why = "Could not ask: Pat is offline until Monday. Settled by: which cache strategy he prefers.";
  let ratedId = "";
  await test.step("deposit a rated draft and an unrated one", async () => {
    ratedId = await deposit(request, c.patKeyA, recipeText(m.rated), { book: c.shared.slug, impact: "high", uncertainty: "low", why });
    await deposit(request, c.patKeyB, recipeText(m.unrated), { book: c.quiet.slug });
  });
  await signIn(page, c.pat, "/app/drafts");
  await openQueue(page);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  await test.step("the rated item", async () => {
    const it = item(page, m.rated);
    await expect(it.locator("p[id^='draft-']"), "the item should show the recipe text").toHaveText(recipeText(m.rated));
    await expect(it, "the item should name its book").toContainText(`Recipe book: ${c.shared.name}`);
    await expect(it, "the ratings should be worded as the agent's").toContainText("Depositing agent's ratings: impact high · uncertainty low");
    await expect(it, "the item should say when it was deposited").toContainText(`Deposited ${today}`);
    await expect(it, "the item should name the depositing key's label").toContainText(c.keyALabel);
    await expect(it.getByText(why), "the first evidence interpretation should be visible without opening anything").toBeVisible();
    await expect(it.getByRole("link", { name: /^Open recipe/ }), "the item should link to the detail page").toBeVisible();
    await expect(actionButtons(it), "the item should offer the three actions").toHaveCount(3);
    testInfo.annotations.push({ type: "E3 rated item text", description: (await it.innerText()).replace(/\n+/g, " / ") });
    await it.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E3-01-item-rated");
  });
  await test.step("the unrated item", async () => {
    const it = item(page, m.unrated);
    await expect(it, "the unrated item should say not rated").toContainText("Depositing agent's ratings: not rated");
    await expect(it, "the unrated item should name its book").toContainText(`Recipe book: ${c.quiet.name}`);
    await expect(it, "the unrated item should name its key's label").toContainText(c.keyBLabel);
    await expect(it, "the unrated item should show its first interpretation").toContainText("Could not ask: the person is away.");
    await expect(actionButtons(it), "the unrated item should offer the three actions").toHaveCount(3);
    testInfo.annotations.push({ type: "E3 unrated item text", description: (await it.innerText()).replace(/\n+/g, " / ") });
    await it.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E3-02-item-unrated");
  });
  await test.step("follow the detail link", async () => {
    await item(page, m.rated).getByRole("link", { name: /^Open recipe/ }).click();
    await expect(page, "the detail link should land on that recipe's page").toHaveURL(new RegExp(`/app/traces/${ratedId}`));
    await expect(page.getByText(m.rated).first(), "the detail page should show the recipe").toBeVisible();
    await shot(page, testInfo, "E3-03-detail-from-queue");
  });
});

test("E4 triage order", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e4");
  const m = { lh: tag("e4-low-high"), hl: tag("e4-high-low"), nr: tag("e4-not-rated"), hh: tag("e4-high-high") };
  await test.step("deposit (low, high), (high, low), not rated, (high, high), in that order", async () => {
    await deposit(request, c.patKeyA, recipeText(m.lh), { book: c.shared.slug, impact: "low", uncertainty: "high" });
    await deposit(request, c.patKeyA, recipeText(m.hl), { book: c.shared.slug, impact: "high", uncertainty: "low" });
    await deposit(request, c.patKeyA, recipeText(m.nr), { book: c.shared.slug });
    await deposit(request, c.patKeyA, recipeText(m.hh), { book: c.shared.slug, impact: "high", uncertainty: "high" });
  });
  await signIn(page, c.pat, "/app/drafts");
  await openQueue(page);
  const texts = await itemTexts(page);
  const order = texts.map((t) => Object.entries(m).find(([, v]) => t.includes(v))?.[0] ?? "?");
  testInfo.annotations.push({ type: "E4 order", description: order.join(", ") });
  await shot(page, testInfo, "E4-01-triage-order");
  expect(order, "top to bottom: (high, high), not rated, (high, low), (low, high)").toEqual(["hh", "nr", "hl", "lh"]);
});

test("E5 narrowing the queue with the grammar", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e5");
  const m = { lh: tag("e5-low-high"), hl: tag("e5-high-low"), nr: tag("e5-not-rated"), hh: tag("e5-high-high"), pub: tag("e5-published") };
  await deposit(request, c.patKeyA, recipeText(m.lh), { book: c.shared.slug, impact: "low", uncertainty: "high" });
  await deposit(request, c.patKeyA, recipeText(m.hl), { book: c.shared.slug, impact: "high", uncertainty: "low" });
  await deposit(request, c.patKeyA, recipeText(m.nr), { book: c.shared.slug });
  await deposit(request, c.patKeyA, recipeText(m.hh), { book: c.shared.slug, impact: "high", uncertainty: "high" });
  await deposit(request, c.patKeyA, recipeText(m.pub), { book: c.shared.slug, impact: "high", uncertainty: "low", draft: false });
  await signIn(page, c.pat, "/app/drafts");
  await openQueue(page);
  const box = page.getByLabel("Search your drafts");
  const which = async () => (await itemTexts(page)).map((t) => Object.entries(m).find(([, v]) => t.includes(v))?.[0] ?? "?").sort();
  const submit = async (q: string) => {
    await box.fill(q);
    await page.getByRole("button", { name: "Search", exact: true }).click();
  };

  await test.step("impact:high", async () => {
    await submit("impact:high");
    await expect(page, "the query should land in the URL").toHaveURL(/q=impact/);
    await expect(items(page), "impact:high should list two drafts").toHaveCount(2);
    expect(await which(), "impact:high should list (high, high) and (high, low) only, not the unrated one or the published recipe").toEqual(["hh", "hl"]);
    await shot(page, testInfo, "E5-01-impact-high");
  });
  await test.step("uncertainty:low", async () => {
    await submit("uncertainty:low");
    await expect(items(page), "uncertainty:low should list one draft").toHaveCount(1);
    expect(await which(), "uncertainty:low should list (high, low) only").toEqual(["hl"]);
    await shot(page, testInfo, "E5-02-uncertainty-low");
  });
  await test.step("impact:urgent", async () => {
    await submit("impact:urgent");
    const alert = page.getByRole("alert");
    await expect(alert, "an invalid value should show the parser's error").not.toHaveText("");
    const msg = (await alert.innerText()).trim();
    testInfo.annotations.push({ type: "E5 error text", description: msg });
    for (const v of ["low", "medium", "high"]) expect(msg, `the error should name ${v}`).toContain(v);
    expect(await which(), "the previous list (uncertainty:low) should stay").toEqual(["hl"]);
    await shot(page, testInfo, "E5-03-invalid-value-error");
  });
  await test.step("clear the box", async () => {
    await submit("");
    await expect(items(page), "clearing should restore all four drafts").toHaveCount(4);
    expect(await which(), "clearing should list the four drafts, not the published recipe").toEqual(["hh", "hl", "lh", "nr"]);
    testInfo.annotations.push({ type: "E5 alert after clear", description: (await page.getByRole("alert").innerText()).trim() || "(empty)" });
    await shot(page, testInfo, "E5-04-cleared");
  });
  await test.step("control: author:me", async () => {
    await submit("author:me");
    await expect(page, "the query should land in the URL").toHaveURL(/q=author/);
    await expect(items(page), "author:me should list Pat's four drafts").toHaveCount(4);
    expect(await which(), "author:me should list his drafts, never his published recipe").toEqual(["hh", "hl", "lh", "nr"]);
    await shot(page, testInfo, "E5-05-author-me-control");
  });
});

test("E6 paging reaches every draft once", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const pat = await actor(request, "e6-pat");
  const key = await mintKey(request, pat, [pat.personalBookId], pat.personalBookId, `e6 key ${RUN}`);
  const base = tag("e6paging");
  for (let i = 0; i < 21; i++) {
    await deposit(request, key, `As a backend maintainer working on paging (${base}), I prefer page ${i} of the same thought so that folding would hide it.`);
  }
  await signIn(page, pat, "/app/drafts");
  await openQueue(page);
  const seen: string[] = [];
  const collect = async () => {
    const hrefs = await items(page).getByRole("link", { name: /^Open recipe/ }).evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
    seen.push(...hrefs.map((h) => h.split("/").pop()!));
    return hrefs.length;
  };
  await expect(totalLine(page), "the total shown should be 21").toContainText("21 drafts await your review");
  const firstCount = await collect();
  testInfo.annotations.push({ type: "E6 page size", description: String(firstCount) });
  testInfo.annotations.push({ type: "E6 total line", description: (await totalLine(page).innerText()).trim() });
  await shot(page, testInfo, "E6-01-first-page");
  let guard = 0;
  while (guard++ < 5) {
    const next = page.getByRole("button", { name: /Next/ });
    if ((await next.count()) === 0 || (await next.isDisabled())) break;
    const firstOnPage = await items(page).first().getByRole("link", { name: /^Open recipe/ }).getAttribute("href");
    await next.click();
    await expect(page, "Next should move to another page").toHaveURL(/page=\d/);
    await expect
      .poll(async () => items(page).first().getByRole("link", { name: /^Open recipe/ }).getAttribute("href"), { message: "the next page should show other drafts" })
      .not.toBe(firstOnPage);
    await collect();
  }
  await shot(page, testInfo, "E6-02-last-page");
  testInfo.annotations.push({ type: "E6 seen", description: `${seen.length} seen, ${new Set(seen).size} distinct` });
  expect(seen.length, "the pages together should show 21 drafts").toBe(21);
  expect(new Set(seen).size, "no draft should appear twice").toBe(21);
});

test("E7 confirm, reject, not chosen", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e7");
  const samKey = await mintKey(request, c.sam, [c.shared.id], c.shared.id, `e7 sam key ${RUN}`);
  const m = { a: tag("e7alpha"), b: tag("e7bravo"), c: tag("e7charlie") };
  const id: Record<string, string> = {};
  // Deposit C, B, A so the triage tiebreak (most recent first) lists A, B, C.
  id["c"] = await deposit(request, c.patKeyA, recipeText(m.c), { book: c.shared.slug });
  id["b"] = await deposit(request, c.patKeyA, recipeText(m.b), { book: c.shared.slug });
  id["a"] = await deposit(request, c.patKeyA, recipeText(m.a), { book: c.shared.slug });
  await signIn(page, c.pat, "/app/drafts");
  await openQueue(page);
  const order = (await itemTexts(page)).map((t) => Object.entries(m).find(([, v]) => t.includes(v))?.[0] ?? "?");
  testInfo.annotations.push({ type: "E7 initial order", description: order.join(", ") });
  await expect(totalLine(page), "three drafts await review").toContainText("3 drafts await your review");
  await shot(page, testInfo, "E7-01-before");

  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "none";
      return `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}: ${(el.innerText ?? "").slice(0, 160).replace(/\n/g, " / ")}`;
    });

  const steps: Array<{ key: "a" | "b" | "c"; button: RegExp; shotName: string; remaining: number; focusOn: string | null }> = [
    { key: "a", button: /^Confirm/, shotName: "E7-02-after-confirm", remaining: 2, focusOn: m.b },
    { key: "b", button: /^Reject/, shotName: "E7-03-after-reject", remaining: 1, focusOn: m.c },
    { key: "c", button: /^Not chosen/, shotName: "E7-04-after-not-chosen", remaining: 0, focusOn: null },
  ];
  for (const s of steps) {
    await test.step(`${s.button.source} ${s.key.toUpperCase()}`, async () => {
      await item(page, m[s.key]).getByRole("button", { name: s.button }).click();
      await expect(item(page, m[s.key]), `${s.key.toUpperCase()} should leave the list at once`).toHaveCount(0);
      await expect(page.getByRole("status"), "the outcome should be announced").not.toHaveText("");
      testInfo.annotations.push({ type: `E7 announce ${s.key.toUpperCase()}`, description: await page.getByRole("status").innerText() });
      const f = await focused();
      testInfo.annotations.push({ type: `E7 focus after ${s.key.toUpperCase()}`, description: f });
      if (s.focusOn) {
        expect(f, `focus should land on the next item (${s.focusOn})`).toContain(s.focusOn);
        await expect(totalLine(page), `the total should drop to ${s.remaining}`).toContainText(`${s.remaining} draft${s.remaining === 1 ? "" : "s"} await`);
      } else {
        expect(f, "after the last item, focus should be on the queue heading or the empty-state text").toMatch(/^h1: Drafts awaiting your review|queue-empty|No drafts await/);
        await expect(page.getByTestId("queue-empty"), "the empty state should show").toBeVisible();
      }
      await shot(page, testInfo, s.shotName);
      await page.reload();
      await openQueue(page, page.url());
      await expect(items(page), `after a reload, ${s.remaining} drafts should remain`).toHaveCount(s.remaining);
    });
  }
  const statusOf = async (key: "a" | "b" | "c", shotName: string) => {
    await page.goto(`/app/traces/${id[key]}`);
    const status = page.getByTestId("draft-status");
    await expect(status, `${key.toUpperCase()}'s detail page should show its draft status`).toBeVisible();
    const text = (await status.innerText()).trim();
    const pressed = await page.locator("button[aria-pressed='true']").allInnerTexts();
    testInfo.annotations.push({ type: `E7 ${key.toUpperCase()} detail`, description: `${text}; pressed: ${pressed.join(", ") || "none"}` });
    await shot(page, testInfo, shotName);
    return { text, pressed };
  };
  await test.step("detail pages", async () => {
    const a = await statusOf("a", "E7-05-a-detail");
    expect(a.text, "A's page should show it verified").toMatch(/^Verified draft/);
    const b = await statusOf("b", "E7-06-b-detail");
    expect(b.text, "B's page should show it rejected").toMatch(/^Rejected draft/);
    const cc = await statusOf("c", "E7-07-c-detail");
    expect(cc.text, "C's page should show it not chosen").toMatch(/^Draft not chosen/);
    expect(cc.pressed.filter((t) => /Still true|Stale|Wrong/.test(t)), "C's page should have no reaction selected").toEqual([]);
  });
  await test.step("Sam's key searches the shared book", async () => {
    const search = async (marker: string) => {
      const qs = new URLSearchParams({ key: samKey, format: "json", filter: `"${marker}"`, clusters: "100" });
      const res = await request.get(`${BACKEND_URL}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
      const body = await res.json();
      expect(body.ok, `Sam's search for ${marker} should run; got ${JSON.stringify(body).slice(0, 200)}`).toBe(true);
      return (body.data.results as Array<{ recipeId: string }>).map((r) => r.recipeId);
    };
    const fa = await search(m.a);
    const fb = await search(m.b);
    const fc = await search(m.c);
    testInfo.annotations.push({ type: "E7 Sam search", description: `A: ${fa.join(",") || "none"}; B: ${fb.join(",") || "none"}; C: ${fc.join(",") || "none"}` });
    expect(fa, "Sam's search should find the confirmed draft A").toContain(id["a"]);
    expect(fb, "Sam's search should not find the rejected draft B").not.toContain(id["b"]);
    expect(fc, "Sam's search should not find the not-chosen draft C").not.toContain(id["c"]);
  });
});

test("E8 actions are refused honestly without write access", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e8");
  const removal = await newBook(request, c.sam, "e8-removal", [c.pat]);
  const keyB = await mintKey(request, c.pat, [removal.id, c.shared.id], removal.id, `e8 key B ${RUN}`);
  const m = { gone: tag("e8gone"), ok: tag("e8writable") };
  const goneId = await deposit(request, keyB, recipeText(m.gone), { book: removal.slug });
  const okId = await deposit(request, c.patKeyA, recipeText(m.ok), { book: c.shared.slug });
  const del = await request.delete(`${BACKEND_URL}/recipe-books/${removal.id}/members/${c.pat.userId}`, { headers: asUser(c.sam) });
  expect(del.status(), "Sam removing Pat from the book should succeed").toBe(200);
  await signIn(page, c.pat, "/app/drafts");
  await test.step("the queue list leaves out the draft in the book Pat left", async () => {
    await openQueue(page);
    await expect(item(page, m.ok), "the writable draft is listed").toHaveCount(1);
    await expect(item(page, m.gone), "the draft in the book Pat left should not be in the queue list").toHaveCount(0);
  });
  await test.step("the id-list link to the draft in the book Pat left", async () => {
    await openQueue(page, `/app/drafts?ids=${goneId}`);
    const it = item(page, m.gone);
    await expect(it, "the item should show").toHaveCount(1);
    await expect(actionButtons(it), "its actions should be unavailable").toHaveCount(0);
    const text = (await it.innerText()).replace(/\n+/g, " / ");
    testInfo.annotations.push({ type: "E8 blocked item", description: text });
    expect(text, "a visible reason should name the book").toContain(removal.name);
    expect(text.toLowerCase(), "the reason should say write access is needed").toContain("write access");
    await shot(page, testInfo, "E8-01-no-write-reason");
  });
  await test.step("control: a writable draft through the same link shape", async () => {
    await openQueue(page, `/app/drafts?ids=${okId}`);
    const it = item(page, m.ok);
    await expect(actionButtons(it), "the writable draft should offer three working actions").toHaveCount(3);
    for (const b of await actionButtons(it).all()) await expect(b, "each action should be enabled").toBeEnabled();
    await shot(page, testInfo, "E8-02-control-writable");
  });
});

test("E9 the id-list link shows exactly the named drafts Pat may see", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e9");
  const samKey = await mintKey(request, c.sam, [c.shared.id], c.shared.id, `e9 sam key ${RUN}`);
  const m = { a: tag("e9a"), b: tag("e9b"), c: tag("e9c") };
  const a = await deposit(request, c.patKeyA, recipeText(m.a), { book: c.shared.slug });
  const b = await deposit(request, c.patKeyA, recipeText(m.b), { book: c.shared.slug });
  const cc = await deposit(request, samKey, recipeText(m.c), { book: c.shared.slug });
  const randomUuid = "5d6c1e0a-8b7f-4c2d-9e3a-1f0b2c4d6e8a";
  await signIn(page, c.pat, `/app/drafts?ids=${b},${a},${cc}`);
  const mainText = async () => (await page.getByRole("main").innerText()).trim();
  const order = async () => (await itemTexts(page)).map((t) => Object.entries(m).find(([, v]) => t.includes(v))?.[0] ?? "?");

  let t1 = "";
  await test.step("(1) b, a, Sam's c", async () => {
    await openQueue(page, `/app/drafts?ids=${b},${a},${cc}`);
    await expect(items(page), "two items should show").toHaveCount(2);
    expect(await order(), "b then a, in the given order, and nothing of c").toEqual(["b", "a"]);
    t1 = await mainText();
    testInfo.annotations.push({ type: "E9 heading", description: await page.getByRole("heading", { level: 1 }).innerText() });
    testInfo.annotations.push({ type: "E9 (1) text", description: t1.replace(/\n+/g, " / ") });
    await shot(page, testInfo, "E9-01-with-sams-id");
  });
  await test.step("(2) b, a, a random UUID", async () => {
    await openQueue(page, `/app/drafts?ids=${b},${a},${randomUuid}`);
    await expect(items(page), "two items should show").toHaveCount(2);
    expect(await order(), "b then a").toEqual(["b", "a"]);
    const t2 = await mainText();
    testInfo.annotations.push({ type: "E9 (2) text", description: t2.replace(/\n+/g, " / ") });
    expect(t2, "a hidden draft's id and a random UUID should produce the same page").toBe(t1);
    await shot(page, testInfo, "E9-02-with-random-id");
  });
  await test.step("(3) a's first 8 characters", async () => {
    await openQueue(page, `/app/drafts?ids=${a.slice(0, 8)}`);
    await expect(items(page), "one item should show").toHaveCount(1);
    expect(await order(), "the prefix should resolve to a").toEqual(["a"]);
    await shot(page, testInfo, "E9-03-prefix");
  });
  await test.step("(4) a, a", async () => {
    await openQueue(page, `/app/drafts?ids=${a},${a}`);
    await expect(items(page), "a should show once").toHaveCount(1);
    testInfo.annotations.push({ type: "E9 (4) text", description: (await mainText()).replace(/\n+/g, " / ") });
    await shot(page, testInfo, "E9-04-duplicate");
  });
});

test("E10 a linked recipe that is not an open draft shows its state, without actions", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e10");
  const m = { a: tag("e10a"), b: tag("e10b"), c: tag("e10c"), p: tag("e10pub") };
  const id: Record<string, string> = {};
  id["c"] = await deposit(request, c.patKeyA, recipeText(m.c), { book: c.shared.slug });
  id["b"] = await deposit(request, c.patKeyA, recipeText(m.b), { book: c.shared.slug });
  id["a"] = await deposit(request, c.patKeyA, recipeText(m.a), { book: c.shared.slug });
  id["p"] = await deposit(request, c.patKeyA, recipeText(m.p), { book: c.shared.slug, draft: false });
  await test.step("resolve A, B, C in the queue (confirm, reject, not chosen)", async () => {
    await signIn(page, c.pat, "/app/drafts");
    await openQueue(page);
    for (const [k, name] of [["a", /^Confirm/], ["b", /^Reject/], ["c", /^Not chosen/]] as const) {
      await item(page, m[k]).getByRole("button", { name }).click();
      await expect(item(page, m[k]), `${k} leaves the list`).toHaveCount(0);
    }
  });
  await test.step("open the link to A, B, C and the published recipe", async () => {
    await openQueue(page, `/app/drafts?ids=${id["a"]},${id["b"]},${id["c"]},${id["p"]}`);
    await expect(items(page), "all four should be shown").toHaveCount(4);
    await expect(actionButtons(page), "none should have action buttons").toHaveCount(0);
    const states: string[] = [];
    for (const k of ["a", "b", "c", "p"] as const) {
      const txt = (await item(page, m[k]).innerText()).replace(/\n+/g, " / ");
      states.push(`${k.toUpperCase()}: ${txt}`);
    }
    testInfo.annotations.push({ type: "E10 items", description: states.join(" || ") });
    await shot(page, testInfo, "E10-01-resolved-states");
    await expect(item(page, m.b), "B should show it was rejected").toContainText(/Rejected/);
    await expect(item(page, m.c), "C should show it was not chosen").toContainText(/not chosen/i);
    await expect(item(page, m.p), "the published recipe should show it is published").toContainText(/Published/);
    await expect(item(page, m.a), "A should show it was verified").toContainText(/verified/i);
  });
});

test("E11 the link survives signing in", async ({ browser, request }, testInfo) => {
  const c = await cast(request, "e11");
  const m = { a: tag("e11a"), b: tag("e11b") };
  const a = await deposit(request, c.patKeyA, recipeText(m.a), { book: c.shared.slug });
  const b = await deposit(request, c.patKeyA, recipeText(m.b), { book: c.shared.slug });
  const freshPage = async () => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => localStorage.setItem("cookie_notice_dismissed", "true"));
    return ctx.newPage();
  };
  const signInForm = async (p: Page) => {
    await p.getByLabel("Email").fill(c.pat.email);
    await p.getByLabel("Password").fill(c.pat.password);
    await p.getByRole("button", { name: "Sign In" }).click();
  };
  await test.step("open the link signed out, then sign in", async () => {
    const p = await freshPage();
    await p.goto(`/app/drafts?ids=${a},${b}`);
    await expect(p, "signed out, the link should go to sign-in").toHaveURL(/\/auth\/login/);
    testInfo.annotations.push({ type: "E11 sign-in URL", description: p.url() });
    await signInForm(p);
    await expect(p, "after signing in, the person should land back on the link").toHaveURL(new RegExp(`/app/drafts\\?ids=${a}(%2C|,)${b}`));
    await expect(items(p), "the queue should show a and b").toHaveCount(2);
    await shot(p, testInfo, "E11-01-after-signin");
    await p.context().close();
  });
  for (const hostile of ["https://example.com/", "//example.com/"]) {
    await test.step(`hostile return target ${hostile}`, async () => {
      const p = await freshPage();
      await p.goto(`/auth/login?next=${encodeURIComponent(hostile)}`);
      await signInForm(p);
      await p.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 10_000 }).catch(() => undefined);
      await p.waitForTimeout(500);
      const url = new URL(p.url());
      testInfo.annotations.push({ type: `E11 after ${hostile}`, description: p.url() });
      expect(url.hostname, `signing in with next=${hostile} should stay in the app, never go to example.com`).not.toContain("example.com");
      expect(url.pathname, "the hostile target should land inside the app").toMatch(/^\/app\//);
      if (hostile.startsWith("//")) await shot(p, testInfo, "E11-02-hostile-target-ignored");
      await p.context().close();
    });
  }
});

test("E12 the dashboard points to the queue", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e12");
  const m = { a: tag("e12a"), b: tag("e12b") };
  await deposit(request, c.patKeyA, recipeText(m.a), { book: c.shared.slug });
  await deposit(request, c.patKeyA, recipeText(m.b), { book: c.shared.slug });
  await signIn(page, c.pat, "/app/dashboard");
  await test.step("the dashboard entry", async () => {
    const entry = page.getByTestId("drafts-entry");
    await expect(entry, "the entry should say 2 drafts await review").toContainText("2 drafts await your review");
    const entryBox = await entry.boundingBox();
    const log = page.getByRole("heading", { name: "Recipe Check Log" });
    const logBox = await log.boundingBox();
    testInfo.annotations.push({ type: "E12 positions", description: `entry y=${entryBox?.y}, Recipe Check Log y=${logBox?.y}` });
    expect(entryBox!.y, "the entry should sit above the activity items").toBeLessThan(logBox!.y);
    const navLinks = await page.locator("nav a, aside a").allInnerTexts();
    testInfo.annotations.push({ type: "E12 nav items (open question)", description: navLinks.map((t) => t.trim()).filter(Boolean).join(" | ") });
    await shot(page, testInfo, "E12-01-dashboard-entry");
    await entry.getByRole("link").click();
    await expect(page, "the entry should lead to /app/drafts").toHaveURL(/\/app\/drafts$/);
    await expect(totalLine(page), "the queue's total should be 2").toContainText("2 drafts await your review");
  });
  await test.step("resolve both, return to the dashboard", async () => {
    await item(page, m.a).getByRole("button", { name: /^Confirm/ }).click();
    await expect(item(page, m.a)).toHaveCount(0);
    await item(page, m.b).getByRole("button", { name: /^Reject/ }).click();
    await expect(item(page, m.b)).toHaveCount(0);
    await page.getByRole("link", { name: /Dashboard/ }).first().click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", { name: "Recipe Check Log" }), "the dashboard should load").toBeVisible();
    await expect(page.getByTestId("drafts-entry"), "after both are resolved the entry should be gone").toHaveCount(0);
    await shot(page, testInfo, "E12-02-dashboard-no-entry");
  });
});

test("E13 empty state", async ({ page, request, browser }, testInfo) => {
  const fresh = await actor(request, "e13-empty");
  await test.step("a user with no drafts", async () => {
    await signIn(page, fresh, "/app/drafts");
    await openQueue(page);
    await expect(page.getByTestId("queue-empty"), "a line should say no drafts await review").toContainText("No drafts await your review");
    await expect(actionButtons(page), "there should be no action buttons").toHaveCount(0);
    await shot(page, testInfo, "E13-01-empty");
  });
  await test.step("control: Pat with one draft", async () => {
    const c = await cast(request, "e13");
    const mk = tag("e13one");
    await deposit(request, c.patKeyA, recipeText(mk), { book: c.shared.slug });
    const p = await newSignedInPage(browser, testInfo, c.pat, "/app/drafts");
    await openQueue(p);
    await expect(items(p), "one item should show").toHaveCount(1);
    await expect(actionButtons(item(p, mk)), "it should have its actions").toHaveCount(3);
    await shot(p, testInfo, "E13-02-control-one-draft");
    await p.context().close();
  });
});

test("E14 accessibility scan", async ({ page, request, browser }, testInfo) => {
  const c = await cast(request, "e14");
  const removal = await newBook(request, c.sam, "e14-removal", [c.pat]);
  const keyB = await mintKey(request, c.pat, [removal.id, c.shared.id], removal.id, `e14 key B ${RUN}`);
  const gone = await deposit(request, keyB, recipeText(tag("e14gone")), { book: removal.slug });
  const a = await deposit(request, c.patKeyA, recipeText(tag("e14a")), { book: c.shared.slug, impact: "high", uncertainty: "low" });
  await deposit(request, c.patKeyA, recipeText(tag("e14b")), { book: c.shared.slug });
  await request.delete(`${BACKEND_URL}/recipe-books/${removal.id}/members/${c.pat.userId}`, { headers: asUser(c.sam) });
  const results: Record<string, string[]> = {};
  await signIn(page, c.pat, "/app/drafts");
  await openQueue(page);
  await expect(items(page)).toHaveCount(2);
  results["queue"] = await axeScan(page, testInfo, "E14-queue");
  await openQueue(page, `/app/drafts?ids=${a},${gone}`);
  await expect(items(page)).toHaveCount(2);
  results["idlink"] = await axeScan(page, testInfo, "E14-idlink");
  await openQueue(page, `/app/drafts?ids=${gone}`);
  await expect(items(page)).toHaveCount(1);
  results["nowrite"] = await axeScan(page, testInfo, "E14-nowrite");
  await page.goto("/app/dashboard");
  await expect(page.getByTestId("drafts-entry")).toBeVisible();
  results["dashboard"] = await axeScan(page, testInfo, "E14-dashboard");
  const fresh = await actor(request, "e14-empty");
  const p = await newSignedInPage(browser, testInfo, fresh, "/app/drafts");
  await openQueue(p);
  await expect(p.getByTestId("queue-empty")).toBeVisible();
  results["empty"] = await axeScan(p, testInfo, "E14-empty");
  await p.context().close();
  testInfo.annotations.push({ type: "E14 serious/critical", description: JSON.stringify(results) });
  for (const [state, v] of Object.entries(results)) expect(v, `axe should find zero serious or critical violations on ${state}`).toEqual([]);
});

test("E15 keyboard only, and telling the buttons apart", async ({ page, request }, testInfo) => {
  const c = await cast(request, "e15");
  const m = { x: tag("e15x"), y: tag("e15y"), z: tag("e15z") };
  await deposit(request, c.patKeyA, recipeText(m.z), { book: c.shared.slug });
  await deposit(request, c.patKeyA, recipeText(m.y), { book: c.shared.slug });
  await deposit(request, c.patKeyA, recipeText(m.x), { book: c.shared.slug });
  await signIn(page, c.pat, "/app/drafts");
  await openQueue(page);
  const visualOrder = (await itemTexts(page)).map((t) => Object.entries(m).find(([, v]) => t.includes(v))?.[0] ?? "?");
  testInfo.annotations.push({ type: "E15 visual order", description: visualOrder.join(", ") });

  const allNames = await items(page).locator("button, a").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? (e as HTMLElement).innerText));
  const visibleLabels = await actionButtons(page).allInnerTexts();
  testInfo.annotations.push({ type: "E15 accessible names", description: allNames.join(" || ") });
  testInfo.annotations.push({ type: "E15 visible labels (open: does confirm name the book?)", description: visibleLabels.join(" || ") });
  const actionNames = allNames.filter((n) => /^(Confirm|Reject|Not chosen)/.test(n));
  expect(actionNames.length, "nine action buttons").toBe(9);
  expect(new Set(actionNames).size, "every action's accessible name should be unique").toBe(9);
  for (const n of actionNames) expect(Object.values(m).some((v) => n.includes(v)), `the name "${n}" should name its draft`).toBe(true);

  // Tab from the top of the document (as from the address bar).
  await page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => undefined);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: Array<{ name: string; inItem: string | null; visible: boolean }> = [];
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const art = el.closest("[data-testid='queue-item']");
      const cs = getComputedStyle(el);
      const visible = el.matches(":focus-visible") && ((cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none");
      return { name: el.getAttribute("aria-label") ?? el.innerText.trim().slice(0, 80), inItem: art ? art.querySelector("p[id^='draft-']")?.textContent ?? "" : null, visible };
    });
    if (!s) continue;
    stops.push(s);
    if (stops.filter((x) => x.inItem).length >= 12) break;
  }
  const itemStops = stops.filter((s) => s.inItem);
  testInfo.annotations.push({
    type: "E15 tab stops in items",
    description: itemStops.map((s) => `${s.name.slice(0, 50)}${s.visible ? "" : " [NO VISIBLE FOCUS]"}`).join(" || "),
  });
  expect(itemStops.length, "every item's three actions and link should be reachable by Tab").toBe(12);
  const expectedSeq = visualOrder.flatMap((k) => [`Confirm`, `Reject`, `Not chosen`, `Open recipe`].map((p) => `${p}|${m[k as "x"]}`));
  const actualSeq = itemStops.map((s) => `${s.name.match(/^(Confirm|Reject|Not chosen|Open recipe)/)?.[1]}|${Object.values(m).find((v) => s.name.includes(v) || (s.inItem ?? "").includes(v))}`);
  expect(actualSeq, "focus order should follow the visual order").toEqual(expectedSeq);
  for (const s of itemStops) expect(s.visible, `focus should be visible on "${s.name.slice(0, 60)}"`).toBe(true);

  await test.step("Tab to the second draft's confirm and press Enter", async () => {
    await page.reload();
    await openQueue(page, page.url());
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const second = m[visualOrder[1] as "x"];
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
      if (name.startsWith("Confirm") && name.includes(second)) break;
    }
    const name = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    expect(name, "Tab should reach the second draft's confirm").toContain(second);
    await shot(page, testInfo, "E15-01-focus-on-action");
    await page.keyboard.press("Enter");
    await expect(item(page, second), "the confirmed draft should leave the list").toHaveCount(0);
    const status = page.getByRole("status");
    await expect(status, "a live region should announce the result").toContainText(/Confirmed/);
    testInfo.annotations.push({ type: "E15 announcement", description: `${await status.innerText()} (aria-live=${await status.getAttribute("aria-live")})` });
    await shot(page, testInfo, "E15-02-after-enter");
  });
});

test("E16 phone width @mobile", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone layout: mobile project only");
  const c = await cast(request, "e16");
  const longUrl = `https://example.com/${"a-very-long-path-segment-".repeat(8)}end`.slice(0, 200);
  const longWord = "Supercalifragilisticexpialidocious".repeat(4);
  const mk = tag("e16long");
  await deposit(request, c.patKeyA, `${recipeText(mk)} ${longWord}`, {
    book: c.shared.slug,
    impact: "high",
    uncertainty: "high",
    why: `Could not ask: the person is away. ${longWord} See ${longUrl}`,
    cite: longUrl,
  });
  await signIn(page, c.pat, "/app/drafts");
  await openQueue(page);
  // Overflow is measured against the device width (shared helper), never
  // scrollWidth against clientWidth: on the phone project Chrome widens the
  // layout viewport, so that comparison passes on an overflowing page.
  await test.step("the queue", async () => {
    const w = await assertNoHorizontalScroll(page, testInfo, "E16-queue");
    testInfo.annotations.push({ type: "E16 queue widths", description: JSON.stringify(w) });
    const it = item(page, mk);
    const card = (await it.boundingBox())!;
    for (const sel of ["p[id^='draft-']", "p:has-text('Why your agent drafted it')"]) {
      const bb = (await it.locator(sel).first().boundingBox())!;
      expect(bb.x + bb.width, `${sel} should wrap inside its card`).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
    const sizes = await actionButtons(it).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { name: (e as HTMLElement).innerText, w: r.width, h: r.height }; }));
    const link = await it.getByRole("link", { name: /^Open recipe/ }).boundingBox();
    testInfo.annotations.push({ type: "E16 action sizes", description: JSON.stringify(sizes) + ` link: ${link?.width}x${link?.height}` });
    for (const s of sizes) {
      expect(s.w, `${s.name} should be at least 24 px wide`).toBeGreaterThanOrEqual(24);
      expect(s.h, `${s.name} should be at least 24 px tall`).toBeGreaterThanOrEqual(24);
    }
    await shot(page, testInfo, "E16-01-queue-mobile");
  });
  await test.step("the dashboard", async () => {
    await page.goto("/app/dashboard");
    await expect(page.getByTestId("drafts-entry"), "the dashboard shows its entry").toBeVisible();
    const w = await assertNoHorizontalScroll(page, testInfo, "E16-dashboard");
    testInfo.annotations.push({ type: "E16 dashboard widths", description: JSON.stringify(w) });
    await shot(page, testInfo, "E16-02-dashboard-mobile");
  });
  await test.step("the draft deposit notice (amended check; extra screenshot E16-03)", async () => {
    const qs = new URLSearchParams({
      key: c.patKeyA,
      recipe: recipeText(tag("e16notice")),
      evidence: `Could not ask: away.\n> "a quote"\n-- ${longUrl}`,
      recipe_book: c.shared.slug,
      draft: "true",
    });
    await page.goto(`${BACKEND_URL}/check?${qs.toString()}`);
    const notice = page.locator("#check-draft");
    await expect(notice, "the check page should show the draft notice").toBeVisible();
    const noticeText = await notice.innerText();
    testInfo.annotations.push({ type: "E16 deposit notice", description: noticeText });
    const nb = (await notice.boundingBox())!;
    const vw = page.viewportSize()!.width;
    const nsw = await notice.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    const doc = await horizontalOverflow(page);
    testInfo.annotations.push({ type: "E16 notice geometry", description: `box right ${nb.x + nb.width} of ${vw}; notice ${JSON.stringify(nsw)}; page ${JSON.stringify(doc)}` });
    expect(noticeText, "the notice should carry the queue link").toContain("/app/drafts?ids=");
    expect(nsw.sw, "the queue URL should wrap inside the notice").toBeLessThanOrEqual(nsw.cw);
    expect(nb.x + nb.width, "the notice should fit the phone width").toBeLessThanOrEqual(vw + 0.5);
    await notice.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E16-03-deposit-notice-mobile", false);
  });
});

test("E17 nothing else in the draft flows broke", async ({ page, request, browser }, testInfo) => {
  const c = await cast(request, "e17");
  const d1 = await deposit(request, c.patKeyA, recipeText(tag("e17one")), { book: c.shared.slug });
  const d2 = await deposit(request, c.patKeyA, recipeText(tag("e17two")), { book: c.shared.slug });
  await test.step("Pat reacts still true on a draft's detail page", async () => {
    await signIn(page, c.pat, `/app/traces/${d1}`);
    await expect(page.getByTestId("draft-status"), "the page shows the draft as unverified").toContainText("Unverified draft");
    await page.getByRole("button", { name: /^Still true/ }).click();
    await expect(page.getByTestId("draft-status"), "Pat's reaction should verify it").toContainText(/^Verified draft/);
    testInfo.annotations.push({ type: "E17 status after still true", description: await page.getByTestId("draft-status").innerText() });
    await page.reload();
    await expect(page.getByTestId("draft-status"), "after reload it is still verified").toContainText(/^Verified draft/);
    await shot(page, testInfo, "E17-01-detail-still-true");
  });
  await test.step("Sam opens another draft's detail URL", async () => {
    const sp = await newSignedInPage(browser, testInfo, c.sam, `/app/traces/${d2}`);
    await expect(sp.getByText("Trace not found."), "Sam should get the not-found page").toBeVisible();
    const draftText = (await sp.getByRole("main").innerText()).trim();
    await shot(sp, testInfo, "E17-02-sam-not-found");
    await sp.goto("/app/traces/5d6c1e0a-8b7f-4c2d-9e3a-1f0b2c4d6e8a");
    await expect(sp.getByText("Trace not found."), "a random id shows not found").toBeVisible();
    const randomText = (await sp.getByRole("main").innerText()).trim();
    expect(draftText, "Sam's page for the draft should be identical to a random id's").toBe(randomText);
    await sp.context().close();
  });
});
