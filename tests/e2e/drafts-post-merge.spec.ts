import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, signInNewContext, type SeededUser } from "./helpers/accounts";
import { assertNoHorizontalScroll, shot } from "./helpers/evidence";
import { axeBeyondKnown } from "./drafts-known-issues";

// Drafts on main, post-merge: new coverage N1-N7 plus the Extras, verified against
// claimNet docs/working/browser-verification/2026-09-29-drafts-post-merge/expectations.md.
// Fixtures (accounts, a Pat-owned book with Sam as member, scoped keys, deposits
// through MCP check_recipe) go through the API; the steps under test go through
// the browser. Accounts are e2e-pm-<test>-<role>-*@test.local.

const RUN = Date.now().toString(36);
let seq = 0;
/** A single alphanumeric word, so keyword search matches it whole. */
const marker = (what: string) => `zq${what}${RUN}${++seq}`;

interface Actor extends SeededUser {
  personalBookId: string;
  orgId: string;
}
interface Book {
  id: string;
  slug: string;
  name: string;
}

async function actor(request: APIRequestContext, label: string): Promise<Actor> {
  const u = await seedUser(request, `pm-${label}`);
  const books = (await (await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(u) })).json()).data as Array<{
    id: string;
    organization_id: string;
  }>;
  return { ...u, personalBookId: books[0]!.id, orgId: books[0]!.organization_id };
}

async function newBook(request: APIRequestContext, owner: Actor, label: string, members: Actor[]): Promise<Book> {
  const name = `${label} ${RUN}${++seq}`;
  const slug = `${label}-${RUN}${seq}`.toLowerCase();
  const res = await request.post(`${BACKEND_URL}/recipe-books`, { headers: asUser(owner), data: { name, slug, organizationId: owner.orgId } });
  const body = await res.json();
  expect(res.ok(), `fixture: creating book ${name} should succeed; got ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  for (const m of members) {
    const added = await request.post(`${BACKEND_URL}/recipe-books/${body.data.id}/members`, {
      headers: asUser(owner),
      data: { email: m.email, role: "member" },
    });
    expect(added.status(), `fixture: adding ${m.email} to ${name} should succeed`).toBe(201);
  }
  return { id: body.data.id, slug, name };
}

async function mintKey(request: APIRequestContext, who: Actor, books: string[], label: string, depositLevel?: "drafts" | "full"): Promise<string> {
  const data: Record<string, unknown> = {
    readRecipeBookIds: books,
    writeRecipeBookIds: books,
    defaultWriteRecipeBookId: books[0],
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    label,
  };
  if (depositLevel) data["depositLevel"] = depositLevel;
  const res = await request.post(`${BACKEND_URL}/keys/scoped`, { headers: asUser(who), data });
  const body = await res.json();
  expect(res.ok(), `fixture: minting key ${label} should succeed; got ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  return body.data.key as string;
}

function recipeText(m: string, topic = "the recipe book"): string {
  return `As a backend maintainer working on ${topic} (${m}), I prefer small reviewed changes so that nothing ships unseen.`;
}

/** Deposit through MCP check_recipe, the way an agent does. Returns the id and the raw structured result. */
async function deposit(
  request: APIRequestContext,
  key: string,
  text: string,
  opts: { draft?: boolean; impact?: string; uncertainty?: string; book?: string } = {},
): Promise<{ id: string; structured: unknown }> {
  const ev = `Could not ask: the person is away.\n> "quote for ${text.slice(-30)}"\n-- drafts-post-merge.spec.ts`;
  const args: Record<string, unknown> = { recipe: text, supporting_evidence: ev, response_format: "structured" };
  if (opts.draft !== undefined) args["draft"] = opts.draft;
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
  expect(id, `fixture: depositing "${text.slice(0, 60)}" should return a recipe id; got ${raw.slice(0, 400)}`).toBeTruthy();
  return { id: id!, structured: msg.result?.structuredContent?.checked };
}

function note(testInfo: TestInfo, type: string, description: string) {
  testInfo.annotations.push({ type, description });
}

function consoleErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  return errs;
}

async function recordAxe(page: Page, testInfo: TestInfo, name: string) {
  // Known pre-existing findings become "known-issue" annotations
  // (drafts-known-issues.ts); anything else still fails.
  const f = await axeBeyondKnown(page, testInfo, name);
  note(testInfo, `${name} axe blocking beyond the known list`, f.blocking.join(" | ") || "(none)");
  note(testInfo, `${name} axe known nodes`, String(f.knownNodes));
  note(testInfo, `${name} axe moderate`, f.moderate.join(" | ") || "(none)");
  expect.soft(f.blocking, `${name}: no serious or critical axe violations beyond the known list`).toEqual([]);
}

function bookCard(page: Page, name: string): Locator {
  return page.locator("div.card").filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });
}

/** Open Recipe Books, record the book's card, then follow "Review traces". */
async function openBookList(page: Page, testInfo: TestInfo, book: Book, who: string): Promise<void> {
  await page.goto("/app/recipe-books");
  const card = bookCard(page, book.name);
  await expect(card, `${who}'s Recipe Books page should list ${book.name}`).toBeVisible();
  await page.waitForTimeout(500);
  note(testInfo, `${who} Recipe Books card for the book`, (await card.innerText()).replace(/\n+/g, " / "));
  await card.getByRole("link", { name: /Review traces/ }).click();
  await expect(page, "Review traces should open the book's traces page").toHaveURL(new RegExp(`/app/recipe-books/${book.id}/traces`));
  await expect(page.getByRole("heading", { level: 1 }), "the book's traces page should render its heading").toBeVisible();
  await expect(page.getByText(/Loading/), "the traces list should finish loading").toHaveCount(0);
}

/** Read-only keyword search through the agent-facing /check page (logs nothing). Keys never appear in the screenshot. */
async function keywordSearch(page: Page, key: string, word: string): Promise<string> {
  await page.goto(`${BACKEND_URL}/check?key=${encodeURIComponent(key)}&filter=${encodeURIComponent(word)}`);
  const text = await page.locator("body").innerText();
  expect(text, "the search page should never show the key in visible text").not.toContain(key);
  return text;
}

async function searchShot(page: Page, testInfo: TestInfo, name: string) {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true, mask: [page.locator("input[name=key]"), page.locator("input[type=password]")] });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

async function openTrace(page: Page, id: string) {
  await page.goto(`/app/traces/${id}`);
  await expect(page.getByText(/Loading trace/), "the trace page should finish loading").toHaveCount(0);
}

/** Pat, Sam, the shared book Pat owns (Sam a member with read and write), and Pat's ordinary scoped key. */
async function cast(request: APIRequestContext, label: string) {
  const pat = await actor(request, `${label}-pat`);
  const sam = await actor(request, `${label}-sam`);
  const book = await newBook(request, pat, `${label}-shared`, [sam]);
  const patKey = await mintKey(request, pat, [book.id, pat.personalBookId], `${label} Pat agent ${RUN}`);
  return { pat, sam, book, patKey };
}

// Every test's annotations also land in its output folder, so the results
// survive a concurrent run that rewrites the shared JSON report.
test.afterEach(async ({}, testInfo) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(testInfo.outputPath("annotations.json"), JSON.stringify({ title: testInfo.title, project: testInfo.project.name, status: testInfo.status, errors: testInfo.errors.map((e) => e.message), annotations: testInfo.annotations }, null, 2));
});

// ──────────────────────────────────────────────────────────────────────────

test("N1 the recipe page shows the agent's ratings, as the agent's", async ({ page, request }, testInfo) => {
  const c = await cast(request, "n1");
  const errs = consoleErrors(page);
  const m = { rated: marker("n1rated"), unrated: marker("n1unrated") };
  let rated = "", unrated = "";
  await test.step("Pat's key checks a recipe with impact high and uncertainty high, and one with no ratings (not drafts)", async () => {
    rated = (await deposit(request, c.patKey, recipeText(m.rated), { book: c.book.slug, impact: "high", uncertainty: "high" })).id;
    unrated = (await deposit(request, c.patKey, recipeText(m.unrated), { book: c.book.slug })).id;
  });
  await signIn(page, c.pat, "/app/dashboard");
  await test.step("Pat opens the rated recipe's detail page", async () => {
    await openTrace(page, rated);
    await expect(page.getByRole("heading", { level: 1 }), "the detail page should show the rated recipe").toContainText(m.rated);
    const label = page.getByText(/Depositing agent's ratings/);
    await expect(label, "the ratings should read as the depositing agent's, with impact high and uncertainty high").toHaveText("Depositing agent's ratings: impact high · uncertainty high");
    note(testInfo, "N1 ratings hover title", (await label.getAttribute("title")) ?? "(none)");
    const body = await page.locator("main, body").first().innerText();
    note(testInfo, "N1 rated header", (await page.locator("header").last().innerText()).replace(/\n+/g, " / "));
    expect(body, "nothing on the page should say Pat rated or assessed the recipe").not.toMatch(/\b(you|your) (rated|assessed|assessment)\b|Pat's rating/i);
    expect(body, "the page should show no undefined or null values").not.toMatch(/\bundefined\b|\bnull\b/);
    await expect(page.getByTestId("draft-status"), "an ordinary recipe should carry no draft label").toHaveCount(0);
    await shot(page, testInfo, "N1-01-rated-recipe");
  });
  await test.step("Extra: axe on the rated recipe's page", async () => {
    await recordAxe(page, testInfo, "N1-rated-recipe");
  });
  await test.step("Pat opens the unrated recipe's detail page", async () => {
    await openTrace(page, unrated);
    await expect(page.getByRole("heading", { level: 1 }), "the detail page should show the unrated recipe").toContainText(m.unrated);
    await expect(page.getByText(/Agent's ratings|impact|uncertainty/i), "an unrated recipe should show no ratings at all").toHaveCount(0);
    const body = await page.locator("body").innerText();
    expect(body, "the unrated page should show no undefined, null or placeholder rating values").not.toMatch(/\bundefined\b|\bnull\b|not rated/i);
    await shot(page, testInfo, "N1-02-unrated-recipe");
  });
  note(testInfo, "console errors", errs.join(" | ") || "(none)");
});

test("N2 a collaborator never sees the draft anywhere in the app", async ({ page, request, browser }, testInfo) => {
  const c = await cast(request, "n2");
  const shared = marker("n2both");
  const m = { draft: marker("n2draft"), control: marker("n2control") };
  const draftText = recipeText(`${shared} ${m.draft}`);
  const controlText = recipeText(`${shared} ${m.control}`);
  let draftId = "", controlId = "";
  await test.step("Pat's key deposits one draft and one ordinary recipe (the control) in the shared book", async () => {
    draftId = (await deposit(request, c.patKey, draftText, { book: c.book.slug, draft: true })).id;
    controlId = (await deposit(request, c.patKey, controlText, { book: c.book.slug })).id;
  });
  const samKey = await mintKey(request, c.sam, [c.book.id], `n2 Sam agent ${RUN}`);
  const { context, page: sp } = await signInNewContext(browser, testInfo, c.sam, "/app/dashboard");
  const errs = consoleErrors(sp);

  await test.step("1. Sam opens the book's recipe list (Recipe Books → Review traces)", async () => {
    await openBookList(sp, testInfo, c.book, "Sam");
    await expect(sp.getByText(m.control), "the control recipe should be in Sam's view of the book").toBeVisible();
    await expect(sp.getByText(m.draft), "Pat's draft should not be in Sam's view of the book").toHaveCount(0);
    const rows = await sp.locator("a[href^='/app/traces/']").count();
    note(testInfo, "N2 Sam book traces rows", String(rows));
    expect(rows, "the book should list exactly one recipe for Sam (the control), not the draft").toBe(1);
    await shot(sp, testInfo, "N2-01-sam-book-list");
    await recordAxe(sp, testInfo, "N2-sam-book-list");
  });

  await test.step("2. Sam searches the shared marker word (read-only keyword search on the agent check page)", async () => {
    const text = await keywordSearch(sp, samKey, shared);
    note(testInfo, "N2 Sam search page text (first 600 chars)", text.slice(0, 600).replace(/\n+/g, " / "));
    expect(text, "the search should find the control recipe").toContain(m.control);
    expect(text, "the search should not find Pat's draft").not.toContain(m.draft);
    await searchShot(sp, testInfo, "N2-02-sam-search");
  });

  await test.step("3. Sam opens the recipe map for the book", async () => {
    const mapResp = sp.waitForResponse((r) => r.url().includes("/traces/map") && r.request().method() === "GET", { timeout: 30_000 });
    await sp.goto(`/app/map?groupId=${c.book.id}`);
    const body = await (await mapResp).text();
    const json = JSON.parse(body);
    note(testInfo, "N2 Sam map meta", JSON.stringify(json.data?.meta));
    expect(body, "the map data for Sam should include the control recipe").toContain(controlId);
    expect(body, "the map data for Sam should not contain the draft's id").not.toContain(draftId);
    expect(body, "the map data for Sam should not contain the draft's text").not.toContain(m.draft);
    await sp.waitForTimeout(3000);
    const text = await sp.locator("body").innerText();
    expect(text, "the map page should not show the draft's text").not.toContain(m.draft);
    await shot(sp, testInfo, "N2-03-sam-map");
  });

  await test.step("4. Sam's dashboard counts and check log", async () => {
    await sp.goto("/app/dashboard");
    await expect(sp.getByRole("heading", { name: "Dashboard" }), "the dashboard should load").toBeVisible();
    await sp.waitForTimeout(1500);
    await expect(sp.getByTestId("drafts-entry"), "Sam's dashboard should not announce any draft awaiting review").toHaveCount(0);
    const recipesChecked = await sp.locator(".card", { hasText: "Recipes Checked" }).innerText();
    note(testInfo, "N2 Sam dashboard Recipes Checked card", recipesChecked.replace(/\n+/g, " / "));
    const dash = await sp.locator("body").innerText();
    expect(dash, "Sam's dashboard should not show the draft").not.toContain(m.draft);
    await shot(sp, testInfo, "N2-04-sam-dashboard");
    await sp.goto("/app/checks");
    await sp.waitForTimeout(1500);
    const log = await sp.locator("body").innerText();
    note(testInfo, "N2 Sam /app/checks text (first 400)", log.slice(0, 400).replace(/\n+/g, " / "));
    expect(log, "Sam's check log should not show the draft").not.toContain(m.draft);
    await shot(sp, testInfo, "N2-04b-sam-check-log");
  });

  await test.step("5. Sam types the draft's detail URL, then a made-up id's", async () => {
    await openTrace(sp, draftId);
    const draftMain = (await sp.locator("main").innerText()).trim();
    await shot(sp, testInfo, "N2-05-sam-draft-url");
    const madeUp = crypto.randomUUID();
    await openTrace(sp, madeUp);
    const madeUpMain = (await sp.locator("main").innerText()).trim();
    await shot(sp, testInfo, "N2-06-sam-made-up-url");
    note(testInfo, "N2 draft URL main text", draftMain.replace(/\n+/g, " / "));
    note(testInfo, "N2 made-up URL main text", madeUpMain.replace(/\n+/g, " / "));
    expect(draftMain, "the draft's URL should show exactly what a never-existing id shows").toBe(madeUpMain);
    expect(draftMain, "the draft's URL should not show the draft's text").not.toContain(m.draft);
    const a = await request.get(`${BACKEND_URL}/traces/${draftId}`, { headers: asUser(c.sam) });
    const b = await request.get(`${BACKEND_URL}/traces/${madeUp}`, { headers: asUser(c.sam) });
    const [at, bt] = [await a.text(), await b.text()];
    note(testInfo, "N2 API draft id", `${a.status()} ${at}`);
    note(testInfo, "N2 API made-up id", `${b.status()} ${bt}`);
    expect(`${a.status()} ${at}`, "the API should answer the draft's id exactly as a made-up id").toBe(`${b.status()} ${bt}`);
  });
  note(testInfo, "console errors (Sam)", errs.join(" | ") || "(none)");
  await context.close();
});

test("N3 Pat sees their own drafts, labelled, and counted separately @mobile", async ({ page, request }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  const c = await cast(request, mobile ? "n3m" : "n3");
  const errs = consoleErrors(page);
  const m = { d1: marker("n3drafta"), d2: marker("n3draftb"), ord: marker("n3ordinary") };
  const ids: Record<string, string> = {};
  await test.step("Pat's key deposits two drafts and one ordinary recipe in the book", async () => {
    ids["d1"] = (await deposit(request, c.patKey, recipeText(m.d1), { book: c.book.slug, draft: true, impact: "high", uncertainty: "low" })).id;
    ids["d2"] = (await deposit(request, c.patKey, recipeText(m.d2), { book: c.book.slug, draft: true })).id;
    ids["ord"] = (await deposit(request, c.patKey, recipeText(m.ord), { book: c.book.slug })).id;
  });
  await signIn(page, c.pat, "/app/dashboard");

  await test.step("Pat opens the book's recipe list", async () => {
    await openBookList(page, testInfo, c.book, "Pat");
    const row = (k: string) => page.locator("a[href^='/app/traces/']").filter({ hasText: k });
    for (const k of [m.d1, m.d2]) {
      await expect(row(k).getByTestId("draft-status"), `the draft ${k} should be labelled as an unverified draft in the book list`).toHaveText("[Unverified draft]");
    }
    await expect(row(m.ord), "the ordinary recipe should be listed").toHaveCount(1);
    await expect(row(m.ord).getByTestId("draft-status"), "the ordinary recipe should carry no draft label").toHaveCount(0);
    note(testInfo, "N3 open: Pat book list row count", String(await page.locator("a[href^='/app/traces/']").count()));
    await shot(page, testInfo, "N3-01-pat-book-list");
    if (!mobile) await recordAxe(page, testInfo, "N3-pat-book-list");
    await page.goto("/app/recipe-books");
    const card = bookCard(page, c.book.name);
    await expect(card, "the book should be on Recipe Books").toBeVisible();
    await card.getByRole("heading", { level: 3 }).click();
    await page.waitForTimeout(1000);
    note(testInfo, "N3 open: Recipe Books card for the book (expanded)", (await card.innerText()).replace(/\n+/g, " / ").slice(0, 600));
    note(testInfo, "N3 open: recipe count shown on Recipe Books card?", String(/\b\d+\s+(recipes?|traces?)\b/i.test(await card.innerText())));
    await shot(page, testInfo, "N3-01b-pat-recipe-books-card");
  });

  await test.step("Pat opens the dashboard", async () => {
    await page.goto("/app/dashboard");
    const entry = page.getByTestId("drafts-entry");
    await expect(entry, "the dashboard should say 2 drafts await review").toContainText("2 drafts await your review");
    const link = entry.getByRole("link", { name: /Review drafts/ });
    await expect(link, "the drafts entry should link to the queue").toHaveAttribute("href", /\/app\/drafts/);
    await page.waitForTimeout(1000);
    note(testInfo, "N3 Pat Recipes Checked card", (await page.locator(".card", { hasText: "Recipes Checked" }).innerText()).replace(/\n+/g, " / "));
    const logRow = (k: string) => page.locator("section", { hasText: "Recipe Check Log" }).locator("a, div").filter({ hasText: k }).last();
    for (const k of [m.d1, m.d2]) {
      const n = await page.getByText(k).count();
      if (n > 0) await expect(logRow(k).getByTestId("draft-status"), `the draft ${k} should be labelled in the dashboard check log`).toBeVisible();
      note(testInfo, `N3 dashboard shows ${k}`, String(n));
    }
    if ((await page.getByText(m.ord).count()) > 0) {
      await expect(logRow(m.ord).getByTestId("draft-status"), "the ordinary recipe should be unlabelled in the dashboard log").toHaveCount(0);
    }
    await shot(page, testInfo, "N3-02-pat-dashboard");
    if (mobile) await assertNoHorizontalScroll(page, testInfo, "N3-dashboard-phone");
  });

  await test.step("Pat opens each draft's detail page", async () => {
    for (const k of ["d1", "d2"] as const) {
      await openTrace(page, ids[k]!);
      await expect(page.getByRole("heading", { level: 1 }), `the detail page should show draft ${k}`).toContainText(m[k]);
      await expect(page.getByTestId("draft-status"), `draft ${k}'s page should label it an unverified draft`).toHaveText("Unverified draft");
      note(testInfo, `N3 ${k} draft-status title`, (await page.getByTestId("draft-status").getAttribute("title")) ?? "");
      if (k === "d1") {
        await shot(page, testInfo, "N3-03-pat-draft-page");
        if (mobile) await assertNoHorizontalScroll(page, testInfo, "N3-draft-page-phone");
      }
    }
    await openTrace(page, ids["ord"]!);
    await expect(page.getByTestId("draft-status"), "the ordinary recipe's page should carry no draft label").toHaveCount(0);
  });
  note(testInfo, "console errors", errs.join(" | ") || "(none)");
});

test("N4 the data export includes Pat's drafts, marked, and not Sam's view of them", async ({ page, request, browser }, testInfo) => {
  const c = await cast(request, "n4");
  const m = marker("n4draft");
  const text = recipeText(m);
  let draftId = "";
  await test.step("Pat's key deposits a draft in the shared book", async () => {
    draftId = (await deposit(request, c.patKey, text, { book: c.book.slug, draft: true })).id;
  });

  async function exportAs(p: Page, who: string): Promise<string> {
    await p.goto("/app/settings/account");
    const btn = p.getByRole("button", { name: "Export my data (JSON)" });
    await expect(btn, `${who} should have the export button on Settings`).toBeVisible();
    if (who === "Pat") await shot(p, testInfo, "N4-01-export-button");
    const dl = p.waitForEvent("download");
    await btn.click();
    const d = await dl;
    const path = await d.path();
    note(testInfo, `N4 ${who} download filename`, d.suggestedFilename());
    return readFile(path!, "utf8");
  }

  function findById(node: unknown, id: string, path = "$"): Array<{ path: string; obj: Record<string, unknown> }> {
    const out: Array<{ path: string; obj: Record<string, unknown> }> = [];
    if (Array.isArray(node)) node.forEach((v, i) => out.push(...findById(v, id, `${path}[${i}]`)));
    else if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (o["id"] === id) out.push({ path, obj: o });
      for (const [k, v] of Object.entries(o)) out.push(...findById(v, id, `${path}.${k}`));
    }
    return out;
  }

  await test.step("Pat exports their data", async () => {
    await signIn(page, c.pat, "/app/settings/account");
    const raw = await exportAs(page, "Pat");
    const json = JSON.parse(raw);
    note(testInfo, "N4 Pat export top-level keys", Object.keys(json).join(", "));
    const hits = findById(json, draftId);
    await testInfo.attach("N4-pat-export.json", {
      body: JSON.stringify({ topLevelKeys: Object.keys(json), draftEntries: hits }, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("N4-pat-export-full.json", { body: raw, contentType: "application/json" });
    expect(hits.length, "Pat's export should contain the draft by id").toBeGreaterThan(0);
    const d = hits[0]!.obj;
    const stateField = Object.entries(d).find(([k]) => /draft/i.test(k));
    note(testInfo, "N4 Pat draft fields", JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => /draft|state|id|claim|text/i.test(k)))));
    expect(stateField?.[1], "the draft in Pat's export should carry its draft state, unverified").toBe("unverified");
  });

  await test.step("Sam exports their data", async () => {
    const { context, page: sp } = await signInNewContext(browser, testInfo, c.sam, "/app/settings/account");
    const raw = await exportAs(sp, "Sam");
    const json = JSON.parse(raw);
    await testInfo.attach("N4-sam-export.json", { body: raw, contentType: "application/json" });
    note(testInfo, "N4 Sam export top-level keys", Object.keys(json).join(", "));
    expect(raw, "Sam's export should not contain the draft's id").not.toContain(draftId);
    expect(raw, "Sam's export should not contain the draft's text").not.toContain(m);
    await context.close();
  });
});

test("N5 the /check form forces a draft for a headless key", async ({ page, request }, testInfo) => {
  const pat = await actor(request, "n5-pat");
  await newBook(request, pat, "n5-second", []);
  await signIn(page, pat, "/app/keys");

  async function createKey(label: string, headless: boolean): Promise<string> {
    await page.getByRole("button", { name: /Create Key/ }).click();
    await expect(page.getByRole("heading", { name: "New API Key" }), "the new-key form should open").toBeVisible();
    await page.getByLabel("Label (optional)").fill(label);
    const box = page.getByRole("checkbox", { name: "Headless" });
    if (headless) await box.check();
    await page.getByRole("button", { name: "Generate Key" }).click();
    await expect(page.getByText("Key shown once only — copy it now"), "the just-created banner should show the key").toBeVisible();
    const inputs = page.locator("input[readonly].text-mono");
    const values = await inputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const key = values.find((v) => v && !v.startsWith("http"));
    expect(key, "the banner should hold the raw key").toBeTruthy();
    return key!;
  }

  let headlessKey = "", ordinaryKey = "";
  await test.step("Pat makes a headless scoped key and an ordinary one on the API Keys page", async () => {
    headlessKey = await createKey(`N5 headless ${RUN}`, true);
    await page.reload();
    ordinaryKey = await createKey(`N5 ordinary ${RUN}`, false);
    const keys = (await (await request.get(`${BACKEND_URL}/keys`, { headers: asUser(pat) })).json()).data as Array<{ label: string; depositLevel: string }>;
    note(testInfo, "N5 keys", JSON.stringify(keys.map((k) => ({ label: k.label, depositLevel: k.depositLevel }))));
  });

  async function openCheck(key: string) {
    await page.goto(`${BACKEND_URL}/check?key=${encodeURIComponent(key)}`);
    expect(await page.locator("body").innerText(), "the check page should never show the key in visible text").not.toContain(key);
    const box = page.locator("#draft");
    const details = page.locator("details").filter({ has: box });
    const wasOpen = (await details.count()) ? await details.first().evaluate((d) => (d as HTMLDetailsElement).open) : null;
    note(testInfo, "N5 draft box inside a <details> section, open when the page loads?", String(wasOpen));
    if (wasOpen === false) await details.first().locator("summary").first().click();
    await expect(box, "the draft checkbox should be visible once its section is open").toBeVisible();
    return box;
  }

  await test.step("open /check?key=<headless key>", async () => {
    const box = await openCheck(headlessKey);
    await expect(box, "the draft checkbox should be present for the headless key").toHaveCount(1);
    note(testInfo, "N5 headless label", (await page.locator("label[for=draft]").innerText()).trim());
    await box.scrollIntoViewIfNeeded();
    await searchShot(page, testInfo, "N5-01-check-form-headless");
    await expect(box, "for a headless key the draft checkbox should be checked").toBeChecked();
    await expect(box, "for a headless key the draft checkbox should be disabled").toBeDisabled();
  });

  await test.step("open /check?key=<ordinary key> (control)", async () => {
    const box = await openCheck(ordinaryKey);
    await expect(box, "the draft checkbox should be present for the ordinary key").toHaveCount(1);
    note(testInfo, "N5 ordinary label", (await page.locator("label[for=draft]").innerText()).trim());
    await box.scrollIntoViewIfNeeded();
    await searchShot(page, testInfo, "N5-02-check-form-ordinary");
    await expect(box, "for an ordinary key the draft checkbox should be unchecked").not.toBeChecked();
    await expect(box, "for an ordinary key the draft checkbox should be enabled").toBeEnabled();
  });
});

test("N6 a headless key's deposit is a draft, and is reviewed like any draft", async ({ page, request, browser }, testInfo) => {
  const c = await cast(request, "n6");
  const headless = await mintKey(request, c.pat, [c.book.id], `n6 Pat headless ${RUN}`, "drafts");
  const samKey = await mintKey(request, c.sam, [c.book.id], `n6 Sam agent ${RUN}`);
  const m = marker("n6headless");
  let id = "";
  await test.step("1. Pat's headless key checks a recipe with draft: false, through the API", async () => {
    const r = await deposit(request, headless, recipeText(m), { book: c.book.slug, draft: false });
    id = r.id;
    note(testInfo, "N6 structured result (checked)", JSON.stringify(r.structured).slice(0, 800));
  });
  await test.step("2. Pat opens the review queue", async () => {
    await signIn(page, c.pat, "/app/drafts");
    await expect(page.getByRole("heading", { level: 1 }), "the queue should render").toBeVisible();
    await expect(page.getByText("Loading…"), "the queue should finish loading").toHaveCount(0);
    const item = page.getByTestId("queue-item").filter({ hasText: m });
    await expect(item, "the headless deposit should be in Pat's review queue as a draft, although draft: false was sent").toHaveCount(1);
    note(testInfo, "N6 queue item", (await item.innerText()).replace(/\n+/g, " / "));
    await shot(page, testInfo, "N6-01-pat-queue-headless-draft");
  });
  const { context, page: sp } = await signInNewContext(browser, testInfo, c.sam, "/app/dashboard");
  await test.step("3. Sam looks for it (book list and search)", async () => {
    await openBookList(sp, testInfo, c.book, "Sam");
    await expect(sp.getByText(m), "Sam should not see the headless draft in the book list").toHaveCount(0);
    await shot(sp, testInfo, "N6-02-sam-before-confirm");
    const text = await keywordSearch(sp, samKey, m);
    expect(text, "Sam's search should not find the headless draft").not.toContain(m);
    await searchShot(sp, testInfo, "N6-02b-sam-search-before-confirm");
  });
  await test.step("4. Pat confirms it with Still true", async () => {
    await openTrace(page, id);
    await expect(page.getByTestId("draft-status"), "the headless deposit's page should say unverified draft").toHaveText("Unverified draft");
    await page.getByRole("button", { name: /^Still true/ }).click();
    await expect(page.getByTestId("draft-status"), "after Still true the page should say the draft is verified").toHaveText(/^Verified draft/);
    note(testInfo, "N6 after confirm status", await page.getByTestId("draft-status").innerText());
    await shot(page, testInfo, "N6-04-pat-after-still-true");
  });
  await test.step("5. Sam looks again", async () => {
    await openBookList(sp, testInfo, c.book, "Sam");
    await expect(sp.getByText(m), "after Pat confirms, Sam should see the recipe in the book list").toBeVisible();
    const label = sp.locator("a[href^='/app/traces/']").filter({ hasText: m }).getByTestId("draft-status");
    note(testInfo, "N6 Sam's row draft label after confirm", (await label.count()) ? await label.innerText() : "(no draft label)");
    await expect(label.filter({ hasText: /Unverified/ }), "Sam's list row should not say unverified").toHaveCount(0);
    await shot(sp, testInfo, "N6-03-sam-after-confirm");
    const text = await keywordSearch(sp, samKey, m);
    expect(text, "after Pat confirms, Sam's search should find the recipe").toContain(m);
    await searchShot(sp, testInfo, "N6-03b-sam-search-after-confirm");
  });
  await context.close();
});

test("N7 a daily key can't be headless", async ({ page, request }, testInfo) => {
  const pat = await actor(request, "n7-pat");
  await signIn(page, pat, "/app/dashboard");
  await test.step("look for a headless option for daily keys on the dashboard, Recipe Books and API Keys pages", async () => {
    for (const path of ["/app/dashboard", "/app/recipe-books", "/app/keys"]) {
      await page.goto(path);
      await page.waitForTimeout(1500);
      const boxes = await page.getByRole("checkbox", { name: /headless/i }).count();
      const mentions = await page.getByText(/headless/i).count();
      note(testInfo, `N7 ${path}`, `headless checkboxes visible without opening the scoped form: ${boxes}; text mentions: ${mentions}`);
      expect(boxes, `${path} should offer no headless option for daily keys`).toBe(0);
    }
    const daily = page.locator("section, div.card").filter({ has: page.getByRole("heading", { name: "Daily Recipe Check Link" }) }).first();
    await expect(daily.getByText(/headless/i), "the daily-link section should offer no headless choice").toHaveCount(0);
  });
  await test.step("try the daily-key API with headless flags", async () => {
    const a = await request.post(`${BACKEND_URL}/keys/daily`, { headers: asUser(pat), data: { depositLevel: "drafts" } });
    const at = await a.text();
    note(testInfo, "N7 POST /keys/daily depositLevel=drafts", `${a.status()} ${at}`);
    expect(a.ok(), "a daily key asked for depositLevel drafts should be refused").toBe(false);
    const b = await request.post(`${BACKEND_URL}/keys/daily`, { headers: asUser(pat), data: { headless: true } });
    const bt = await b.text();
    note(testInfo, "N7 POST /keys/daily headless=true", `${b.status()} ${bt.replace(/"key":"[^"]+"/, '"key":"<masked>"').replace(/key=[^&"]+/g, "key=<masked>")}`);
  });
  await test.step("the keys list afterwards", async () => {
    const keys = (await (await request.get(`${BACKEND_URL}/keys`, { headers: asUser(pat) })).json()).data as Array<{ keyType: string; depositLevel: string; label: string | null }>;
    note(testInfo, "N7 keys", JSON.stringify(keys.map((k) => ({ keyType: k.keyType, depositLevel: k.depositLevel, label: k.label }))));
    expect(keys.filter((k) => k.keyType === "daily" && k.depositLevel !== "full"), "no daily key should be headless").toEqual([]);
    await page.goto("/app/keys");
    await page.waitForTimeout(1500);
    await expect(page.getByText("Headless: deposits drafts only"), "the keys page should list no headless key").toHaveCount(0);
    await shot(page, testInfo, "N7-01-keys-list-after");
  });
});
