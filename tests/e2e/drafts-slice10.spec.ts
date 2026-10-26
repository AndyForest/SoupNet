import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import postgres from "postgres";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, signInNewContext, type SeededUser } from "./helpers/accounts";
import { assertNoHorizontalScroll, shot, shotMasked } from "./helpers/evidence";
import { axeBeyondKnown } from "./drafts-known-issues";

// Slice 10 (drafts as a bus) browser run: expired drafts on the review queue,
// the detail page and the dashboard, and the web /check page's open-question line.
// Expectations: claimNet docs/working/browser-verification/2026-10-26-drafts-10/expectations.md.
// Cast: Pat (subject; K1 deposits, K2 a second ordinary key), Dana (member,
// deposits on Pat's behalf), Sam (owns the shared book).
// Fixtures (accounts, book, keys, deposits) go through the API; the one SQL
// write ages a draft's created_at. Every step a person takes and every page
// check goes through the browser.
// Accounts: e2e-s10-<test>-<role>-*@test.local.
// Kept as a regression test after the 2026-10-26 run. Against a worktree stack
// with its own database, set E2E_PGDATABASE to that database's name.

const RUN = Date.now().toString(36);
let seq = 0;
const marker = (what: string) => `zq${what}${RUN}${++seq}`;

interface Cast {
  pat: SeededUser;
  dana: SeededUser;
  sam: SeededUser;
  bookId: string;
  bookName: string;
  k1: string;
  k2: string;
  danaKey: string;
}

async function booksOf(request: APIRequestContext, u: SeededUser) {
  const r = await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(u) });
  return (await r.json()).data as Array<{ id: string; organization_id: string }>;
}

async function mint(request: APIRequestContext, u: SeededUser, bookId: string, label: string): Promise<string> {
  const personal = (await booksOf(request, u)).find((b) => b.id !== bookId)!.id;
  const r = await request.post(`${BACKEND_URL}/keys/scoped`, {
    headers: asUser(u),
    data: {
      readRecipeBookIds: [bookId, personal],
      writeRecipeBookIds: [bookId, personal],
      defaultWriteRecipeBookId: bookId,
      expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
      label,
    },
  });
  const body = await r.json();
  expect(r.ok(), `fixture: minting key "${label}" should succeed; got ${r.status()} ${JSON.stringify(body)}`).toBe(true);
  return body.data.key as string;
}

async function setupCast(request: APIRequestContext, label: string): Promise<Cast> {
  const pat = await seedUser(request, `s10-${label}-pat`);
  const dana = await seedUser(request, `s10-${label}-dana`);
  const sam = await seedUser(request, `s10-${label}-sam`);
  const orgId = (await booksOf(request, sam))[0]!.organization_id;
  const slug = `s10-${label}-${RUN}${++seq}`.toLowerCase();
  const bookName = `Shared ${slug}`;
  const created = await request.post(`${BACKEND_URL}/recipe-books`, { headers: asUser(sam), data: { name: bookName, slug, organizationId: orgId } });
  const cb = await created.json();
  expect(created.ok(), `fixture: Sam should create the shared book; got ${created.status()} ${JSON.stringify(cb)}`).toBe(true);
  const bookId = cb.data.id as string;
  for (const m of [pat, dana]) {
    const r = await request.post(`${BACKEND_URL}/recipe-books/${bookId}/members`, { headers: asUser(sam), data: { email: m.email, role: "member" } });
    expect(r.status(), `fixture: Sam should add ${m.email} to the shared book`).toBe(201);
  }
  const k1 = await mint(request, pat, bookId, `K1 Pat depositing agent ${RUN}`);
  const k2 = await mint(request, pat, bookId, `K2 Pat second agent ${RUN}`);
  const danaKey = await mint(request, dana, bookId, `Dana agent ${RUN}`);
  return { pat, dana, sam, bookId, bookName, k1, k2, danaKey };
}

function recipeText(m: string): string {
  return `As a backend maintainer working on the review queue (${m}), I prefer small reviewed changes so that nothing ships unseen.`;
}

/** Deposit a draft through GET /check?format=json (the agent surface). */
async function depositDraft(request: APIRequestContext, key: string, text: string, extra: Record<string, string> = {}): Promise<string> {
  const qs = new URLSearchParams({
    key,
    recipe: text,
    evidence: `Could not ask: the person is away.\n> "deposit quote ${text.slice(-60)}"\n-- drafts-slice10.spec.ts deposit`,
    format: "json",
    draft: "true",
    ...extra,
  });
  const res = await request.get(`${BACKEND_URL}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
  const body = await res.json();
  expect(res.ok(), `fixture: the deposit should succeed; got ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toBe(true);
  const id = body.data?.checked?.recipeId as string | undefined;
  expect(id, "fixture: the deposit should return the new recipe's id").toBeTruthy();
  return id!;
}

// ── The one SQL fixture write the expectations allow: age a draft's created_at.

function dbSettings() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(__dirname, "..", "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return {
    // 127.0.0.1, not the .env's localhost (a stale wslrelay can hold [::1]).
    host: "127.0.0.1",
    port: Number(env["PGPORT"] ?? 5633),
    user: env["PGUSER"]!,
    password: env["PGPASSWORD"]!,
    // The stack's own database: the .env's for the dev stack, or a worktree
    // stack's throwaway one through E2E_PGDATABASE.
    database: process.env["E2E_PGDATABASE"] ?? env["PGDATABASE"] ?? "claimnet",
  };
}

async function ageDraft(id: string, days: number): Promise<void> {
  const sql = postgres({ ...dbSettings(), max: 1, onnotice: () => {} });
  try {
    const rows = await sql`UPDATE claimnet.traces SET created_at = NOW() - make_interval(days => ${days}::int) WHERE id = ${id}::uuid RETURNING id`;
    expect(rows.length, `fixture: aging draft ${id} by ${days} days should update exactly one row`).toBe(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ── Page helpers

function note(testInfo: TestInfo, type: string, description: string) {
  testInfo.annotations.push({ type, description });
}

async function openDetail(page: Page, id: string) {
  await page.goto(`/app/traces/${id}`);
  await expect(page.getByText(/Loading trace/), "the detail page should finish loading").toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 }), "the detail page should render the recipe heading").toBeVisible();
}

async function openQueue(page: Page, path = "/app/drafts") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: /drafts/i }), "the queue should render its heading").toBeVisible();
  await expect(page.getByText("Loading…"), "the queue should finish loading").toHaveCount(0);
  await expect(page.getByTestId("queue-total"), "the queue should show its total line").toBeVisible();
}

const itemFor = (page: Page, m: string): Locator => page.getByTestId("queue-item").filter({ hasText: m });

/** Today's date as the page formats it (toLocaleDateString in the browser). */
async function today(page: Page): Promise<string> {
  return page.evaluate(() => new Date().toLocaleDateString());
}

async function recordStatus(page: Page, testInfo: TestInfo, label: string) {
  const s = page.getByTestId("draft-status");
  note(testInfo, `${label} status text`, (await s.count()) ? await s.innerText() : "(no status line)");
  note(testInfo, `${label} status title`, (await s.count()) ? String(await s.getAttribute("title")) : "(no status line)");
}

async function recordAxe(page: Page, testInfo: TestInfo, name: string) {
  const f = await axeBeyondKnown(page, testInfo, name);
  note(testInfo, `${name} axe blocking beyond the known list`, f.blocking.join(" | ") || "(none)");
  note(testInfo, `${name} axe known (pre-existing) nodes`, String(f.knownNodes));
  note(testInfo, `${name} axe moderate`, f.moderate.join(" | ") || "(none)");
  expect.soft(f.blocking, `${name}: no serious or critical axe violations beyond the known pre-existing list`).toEqual([]);
}

const EXPIRED_LINE = "1 more draft expired unanswered and left this list. You can still answer it.";
const ITEM_NOTE = "Expired unanswered: it has left the queue. You can still answer it.";

/** E1's fixture: K1 deposits two drafts, one aged 8 days (expired), one 6 (live). */
async function setupE1(request: APIRequestContext, label: string) {
  const c = await setupCast(request, label);
  const m = { old: marker(`${label}eight`), live: marker(`${label}six`) };
  const ids = {
    old: await depositDraft(request, c.k1, recipeText(m.old)),
    live: await depositDraft(request, c.k1, recipeText(m.live)),
  };
  await ageDraft(ids.old, 8);
  await ageDraft(ids.live, 6);
  return { c, m, ids };
}

async function checkE1Queue(page: Page, m: { old: string; live: string }) {
  await expect(itemFor(page, m.live), "the 6-day-old draft should be listed in the queue").toHaveCount(1);
  await expect(itemFor(page, m.old), "the 8-day-old (expired) draft should not be listed in the queue").toHaveCount(0);
  const line = page.getByTestId("queue-expired");
  await expect(line, "a line under the total should say one more draft expired unanswered").toContainText(EXPIRED_LINE);
  await expect(line.getByRole("link", { name: "Show expired drafts" }), 'the expired line should end with a "Show expired drafts" link').toBeVisible();
}

async function followExpiredLink(page: Page) {
  await page.getByTestId("queue-expired").getByRole("link", { name: "Show expired drafts" }).click();
  await expect(page, "following the link should put q=is:expired in the URL").toHaveURL(/[?&]q=is(%3A|:)expired/);
  await expect(page.getByText("Loading…"), "the expired listing should finish loading").toHaveCount(0);
  await expect(page.getByTestId("queue-total"), "the listing should show its total line").toBeVisible();
}

test.afterEach(async ({}, testInfo) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    testInfo.outputPath("annotations.json"),
    JSON.stringify({ title: testInfo.title, project: testInfo.project.name, status: testInfo.status, errors: testInfo.errors.map((e) => e.message), annotations: testInfo.annotations }, null, 2),
  );
});

// ──────────────────────────────────────────────────────────────────────────

test("E1: the review queue lists live drafts and says how many more expired", async ({ page, request }, testInfo) => {
  let f!: Awaited<ReturnType<typeof setupE1>>;
  await test.step("fixture: K1 deposits two drafts; one is aged 8 days, the other 6", async () => {
    f = await setupE1(request, "e1");
  });
  await test.step("Pat opens /app/drafts", async () => {
    await signIn(page, f.c.pat, "/app/dashboard");
    await openQueue(page);
    await checkE1Queue(page, f.m);
    const total = page.getByTestId("queue-total");
    const line = page.getByTestId("queue-expired");
    note(testInfo, "E1 total line", await total.innerText());
    note(testInfo, "E1 expired line", await line.innerText());
    const after = await total.evaluate((t, l) => !!(t.compareDocumentPosition(l as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await line.elementHandle());
    expect(after, "the expired line should come after the total line in the page").toBe(true);
    const tb = (await total.boundingBox())!;
    const lb = (await line.boundingBox())!;
    expect(lb.y, "the expired line should sit below the total line").toBeGreaterThanOrEqual(tb.y + tb.height - 1);
    await shot(page, testInfo, "E1-01-queue-live-and-expired-line");
  });
});

test("E2: the link lists the expired drafts, each marked", async ({ page, request }, testInfo) => {
  let f!: Awaited<ReturnType<typeof setupE1>>;
  await test.step("fixture (as E1): an 8-day-old and a 6-day-old draft by K1", async () => {
    f = await setupE1(request, "e2");
  });
  await test.step("Pat opens /app/drafts (E1)", async () => {
    await signIn(page, f.c.pat, "/app/dashboard");
    await openQueue(page);
    await checkE1Queue(page, f.m);
  });
  await test.step('Pat follows "Show expired drafts"', async () => {
    await followExpiredLink(page);
    note(testInfo, "E2 URL", page.url());
    expect(new URL(page.url()).searchParams.get("q"), "the URL's q parameter should be is:expired").toBe("is:expired");
    await expect(page.getByLabel("Search your drafts"), "the search box should show is:expired").toHaveValue("is:expired");
    const old = itemFor(page, f.m.old);
    await expect(old, "the 8-day-old draft should be listed").toHaveCount(1);
    await expect(itemFor(page, f.m.live), "the 6-day-old draft should not be listed").toHaveCount(0);
    await expect(old.getByTestId("queue-expired-item"), "the item should say it expired unanswered and can still be answered").toHaveText(ITEM_NOTE);
    await expect(page.getByTestId("queue-expired"), "the expired-count line should not show while the expired drafts are listed").toHaveCount(0);
    await expect(page.getByText(/expired unanswered and left this list/), "no expired-count wording should appear on the expired listing").toHaveCount(0);
    await expect(old.getByRole("button", { name: /^Confirm/ }), "the item should offer Confirm").toBeVisible();
    await expect(old.getByRole("button", { name: /^Reject/ }), "the item should offer Reject").toBeVisible();
    await expect(old.getByRole("button", { name: /^Not chosen/ }), "the item should offer Not chosen").toBeVisible();
    note(testInfo, "E2 total line", await page.getByTestId("queue-total").innerText());
    note(testInfo, "E2 item text", (await old.innerText()).replace(/\s+/g, " "));
    await shot(page, testInfo, "E2-01-queue-expired-listing");
  });
});

test("E3: Pat rejects an expired draft from the expired listing", async ({ page, request }, testInfo) => {
  let f!: Awaited<ReturnType<typeof setupE1>>;
  await test.step("fixture (as E1): an 8-day-old and a 6-day-old draft by K1", async () => {
    f = await setupE1(request, "e3");
  });
  await test.step("Pat opens the expired listing (E2)", async () => {
    await signIn(page, f.c.pat, "/app/dashboard");
    await openQueue(page);
    await followExpiredLink(page);
    await expect(itemFor(page, f.m.old), "the expired draft should be listed").toHaveCount(1);
  });
  await test.step("Pat rejects the expired draft", async () => {
    await itemFor(page, f.m.old).getByRole("button", { name: /^Reject/ }).click();
    await expect(page.getByRole("status"), "the queue should announce the rejection").toContainText("Rejected");
    note(testInfo, "E3 announcement", await page.getByRole("status").innerText());
    await expect(itemFor(page, f.m.old), "the rejected draft should leave the expired listing").toHaveCount(0);
  });
  await test.step("Pat opens its detail page", async () => {
    await openDetail(page, f.ids.old);
    const date = await today(page);
    await expect(page.getByTestId("draft-status"), `the line should read "Rejected draft (by you on ${date})"`).toHaveText(`Rejected draft (by you on ${date})`);
    await recordStatus(page, testInfo, "E3 detail");
    await shot(page, testInfo, "E3-01-detail-rejected-from-expired");
  });
});

test("E4: no expired line when nothing has expired (control for E1)", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e4");
  const m = marker("e4live");
  await test.step("fixture: K1 deposits one live draft", async () => {
    await depositDraft(request, c.k1, recipeText(m));
  });
  await test.step("Pat opens /app/drafts", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openQueue(page);
    await expect(itemFor(page, m), "the live draft should be listed").toHaveCount(1);
    // The search hint (E10, Found 5) names is:expired as listing "the drafts that
    // expired unanswered"; E4 is about the expired-count line, so the hint is
    // left out of this check and recorded instead.
    const hint = page.locator("#draft-search-hint");
    note(testInfo, "E4 search hint (contains the phrase by design, E10)", (await hint.innerText()).replace(/\s+/g, " "));
    const matches = await page.getByText(/expired unanswered/).evaluateAll((els) => els.filter((e) => !e.closest("#draft-search-hint")).map((e) => (e as HTMLElement).innerText));
    expect(matches, 'apart from the search hint, no line should contain "expired unanswered"').toEqual([]);
    await expect(page.getByRole("link", { name: "Show expired drafts" }), 'there should be no "Show expired drafts" link').toHaveCount(0);
    await expect(page.getByTestId("queue-expired"), "the expired-count line should be absent").toHaveCount(0);
    note(testInfo, "E4 total line", await page.getByTestId("queue-total").innerText());
    await shot(page, testInfo, "E4-01-queue-no-expired");
  });
});

async function checkExpiredDetail(page: Page, when: string) {
  const status = page.getByTestId("draft-status");
  await expect(status, `${when}: the state line should read "Unverified draft, expired"`).toHaveText("Unverified draft, expired");
  const title = (await status.getAttribute("title")) ?? "";
  expect(title, `${when}: the title should say it was deposited over a week ago with no task attached`).toContain("It was deposited over a week ago with no task attached");
  expect(title, `${when}: the title should say it has left the review queue`).toContain("it has left the review queue");
  expect(title, `${when}: the title should say Pat can still verify it with Still true or reject it with Wrong`).toContain("You can still verify it with Still true or reject it with Wrong.");
  await expect(page.getByRole("button", { name: /^Still true/ }), `${when}: Still true should be offered`).toBeVisible();
  await expect(page.getByRole("button", { name: /^Wrong/ }), `${when}: Wrong should be offered`).toBeVisible();
  await expect(page.getByRole("button", { name: /^Stale/ }), `${when}: Stale should not be offered`).toHaveCount(0);
}

test("E5: the detail page of an expired draft, for its person", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e5");
  const m = marker("e5");
  let id = "";
  await test.step("fixture: K1 deposits a draft; it is aged 8 days", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
    await ageDraft(id, 8);
  });
  await test.step("Pat opens its detail page", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, id);
    await checkExpiredDetail(page, "E5 first open");
    await recordStatus(page, testInfo, "E5 first open");
    await shot(page, testInfo, "E5-01-detail-expired");
  });
  await test.step("Pat reloads it", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }), "the detail page should render after reload").toBeVisible();
    await checkExpiredDetail(page, "E5 after reload");
    await recordStatus(page, testInfo, "E5 after reload");
    await shot(page, testInfo, "E5-02-after-reload");
  });
});

test("E6: Pat answers an expired draft with Still true on its detail page", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e6");
  const m = marker("e6");
  let id = "";
  await test.step("fixture (as E5): K1 deposits a draft; it is aged 8 days", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
    await ageDraft(id, 8);
  });
  await test.step("Pat opens its detail page (E5) and clicks Still true", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, id);
    await expect(page.getByTestId("draft-status"), "before the reaction the line should read Unverified draft, expired").toHaveText("Unverified draft, expired");
    await page.getByRole("button", { name: /^Still true/ }).click();
    await expect(page.getByTestId("draft-status"), "after Still true the line should say the draft is verified").toHaveText(/^Verified draft/);
    await recordStatus(page, testInfo, "E6 right after Still true");
  });
  await test.step("Pat reloads", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }), "the detail page should render after reload").toBeVisible();
    const date = await today(page);
    await expect(page.getByTestId("draft-status"), `the line should read "Verified draft (by you on ${date})"`).toHaveText(`Verified draft (by you on ${date})`);
    await recordStatus(page, testInfo, "E6 after reload");
    await shot(page, testInfo, "E6-01-detail-verified-from-expired");
  });
});

test("E7: a live draft's line is unchanged (control for E5)", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e7");
  const m = marker("e7");
  let id = "";
  await test.step("fixture: K1 deposits a draft now", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
  });
  await test.step("Pat opens its detail page", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, id);
    await expect(page.getByTestId("draft-status"), 'the line should read "Unverified draft"').toHaveText("Unverified draft");
    await expect(page.getByRole("button", { name: /^Still true/ }), "Still true should be offered").toBeVisible();
    await expect(page.getByRole("button", { name: /^Wrong/ }), "Wrong should be offered").toBeVisible();
    await recordStatus(page, testInfo, "E7");
    await shot(page, testInfo, "E7-01-detail-live-unchanged");
  });
});

test("E8: the depositor's view of an expired on-behalf draft", async ({ page, request, browser }, testInfo) => {
  const c = await setupCast(request, "e8");
  const m = marker("e8");
  let id = "";
  await test.step("fixture: Dana's key deposits a draft about Pat in the shared book; it is aged 8 days", async () => {
    id = await depositDraft(request, c.danaKey, recipeText(m), { on_behalf_of: c.pat.email });
    await ageDraft(id, 8);
  });
  await test.step("Dana opens its detail page", async () => {
    await signIn(page, c.dana, "/app/dashboard");
    await openDetail(page, id);
    const status = page.getByTestId("draft-status");
    await expect(status, 'the line should read "Unverified draft, expired"').toHaveText("Unverified draft, expired");
    const title = (await status.getAttribute("title")) ?? "";
    expect(title.endsWith(`Only ${c.pat.email} can still verify or reject it.`), `the title should end "Only ${c.pat.email} can still verify or reject it." (got: ${title})`).toBe(true);
    for (const name of [/^Still true/, /^Wrong/, /^Stale/, /^Confirm/, /^Reject/, /^Not chosen/]) {
      await expect(page.getByRole("button", { name }), `Dana should be offered no ${name.source.slice(1)} control that resolves the draft`).toHaveCount(0);
    }
    await recordStatus(page, testInfo, "E8 Dana");
    note(testInfo, "E8 Dana main text", (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 900));
    await shot(page, testInfo, "E8-01-dana-detail-expired");
  });
  await test.step("(recorded, not listed) Pat opens the same draft: the subject's view of its liveness", async () => {
    const { context, page: pp } = await signInNewContext(browser, testInfo, c.pat, "/app/dashboard");
    await openDetail(pp, id);
    await recordStatus(pp, testInfo, "E8 Pat (subject)");
    const b = async (n: RegExp) => (await pp.getByRole("button", { name: n }).count()) > 0;
    note(testInfo, "E8 Pat buttons", `Still true: ${await b(/^Still true/)}, Wrong: ${await b(/^Wrong/)}, Stale: ${await b(/^Stale/)}`);
    await context.close();
  });
});

test("E9: the dashboard's drafts figure counts live drafts only", async ({ page, request }, testInfo) => {
  let f!: Awaited<ReturnType<typeof setupE1>>;
  await test.step("fixture (as E1): an 8-day-old and a 6-day-old draft by K1", async () => {
    f = await setupE1(request, "e9");
  });
  await test.step("Pat opens the dashboard", async () => {
    await signIn(page, f.c.pat, "/app/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" }), "the dashboard should load").toBeVisible();
    const entry = page.getByTestId("drafts-entry");
    await expect(entry.getByRole("heading", { level: 2 }), 'the drafts entry should read "1 draft awaits your review"').toHaveText("1 draft awaits your review");
    note(testInfo, "E9 drafts entry", (await entry.innerText()).replace(/\s+/g, " "));
    await shot(page, testInfo, "E9-01-dashboard-live-count");
  });
});

test("E10: the queue's search hint names is:expired, and typing it works", async ({ page, request }, testInfo) => {
  let f!: Awaited<ReturnType<typeof setupE1>>;
  await test.step("fixture (as E1): an 8-day-old and a 6-day-old draft by K1", async () => {
    f = await setupE1(request, "e10");
  });
  await test.step("Pat opens /app/drafts and reads the search hint", async () => {
    await signIn(page, f.c.pat, "/app/dashboard");
    await openQueue(page);
    const hint = page.locator("#draft-search-hint");
    await expect(hint, "the hint should say is:expired lists the drafts that expired unanswered").toContainText("is:expired lists the drafts that expired unanswered");
    note(testInfo, "E10 hint", (await hint.innerText()).replace(/\s+/g, " "));
  });
  await test.step('Pat types is:expired into "Search your drafts" and submits', async () => {
    await page.getByLabel("Search your drafts").fill("is:expired");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page, "submitting should put q=is:expired in the URL").toHaveURL(/[?&]q=is(%3A|:)expired/);
    await expect(page.getByText("Loading…"), "the listing should finish loading").toHaveCount(0);
    await expect(itemFor(page, f.m.old), "the expired draft should be listed").toHaveCount(1);
    await expect(itemFor(page, f.m.live), "the live draft should not be listed").toHaveCount(0);
    const items = page.getByTestId("queue-item");
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      await expect(items.nth(i).getByTestId("queue-expired-item"), `listed item ${i + 1} should be marked expired`).toBeVisible();
    }
    note(testInfo, "E10 listed items", String(n));
    note(testInfo, "E10 total line", await page.getByTestId("queue-total").innerText());
    await page.locator("#draft-search-hint").scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E10-01-queue-hint-and-typed-search");
  });
});

async function checkLineFits(page: Page, testInfo: TestInfo, loc: Locator, label: string) {
  await loc.scrollIntoViewIfNeeded();
  const vw = page.viewportSize()!.width;
  const box = (await loc.boundingBox())!;
  const m = await loc.evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
    return { sw: el.scrollWidth, cw: el.clientWidth, height: el.getBoundingClientRect().height, lineHeight: lh, overflow: getComputedStyle(el).overflow };
  });
  note(testInfo, `${label} box / metrics`, JSON.stringify({ box, ...m, vw }));
  expect(box.x, `${label}: the line should start inside the screen`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label}: the line should end inside the ${vw}px screen`).toBeLessThanOrEqual(vw);
  expect(m.sw, `${label}: the line's text should not be clipped (scrollWidth within clientWidth)`).toBeLessThanOrEqual(m.cw + 1);
  if (testInfo.project.name === "mobile") {
    expect(m.height, `${label}: at phone width the line should wrap onto more than one line`).toBeGreaterThan(m.lineHeight * 1.5);
  }
}

test("E11: phone width, the expired line and the item note fit and wrap @mobile", async ({ page, request }, testInfo) => {
  let f!: Awaited<ReturnType<typeof setupE1>>;
  await test.step("fixture (as E1): an 8-day-old and a 6-day-old draft by K1", async () => {
    f = await setupE1(request, "e11");
  });
  await test.step("Pat opens E1's queue", async () => {
    await signIn(page, f.c.pat, "/app/dashboard");
    await openQueue(page);
    const vw = page.viewportSize()!.width;
    note(testInfo, "E11 viewport width", String(vw));
    if (testInfo.project.name === "mobile") expect(vw, "the mobile project should be 412px wide").toBe(412);
    await checkE1Queue(page, f.m);
    await checkLineFits(page, testInfo, page.getByTestId("queue-expired"), "E11 queue expired line");
    await assertNoHorizontalScroll(page, testInfo, "E11-queue");
    await page.getByTestId("queue-expired").scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E11-01-mobile-queue");
  });
  await test.step("Pat follows the link to E2's listing", async () => {
    await followExpiredLink(page);
    const noteEl = itemFor(page, f.m.old).getByTestId("queue-expired-item");
    await expect(noteEl, "the expired item's note should be shown").toHaveText(ITEM_NOTE);
    await checkLineFits(page, testInfo, noteEl, "E11 expired item note");
    await assertNoHorizontalScroll(page, testInfo, "E11-expired-listing");
    await noteEl.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E11-02-mobile-expired-listing");
  });
});

test("E12: accessibility of the queue (E1, E2) and the detail pages (E5, E8)", async ({ page, request, browser }, testInfo) => {
  let f!: Awaited<ReturnType<typeof setupE1>>;
  let e5Id = "", e8Id = "";
  await test.step("fixture: E1's two drafts; E5's expired draft by K1; E8's expired draft by Dana about Pat", async () => {
    f = await setupE1(request, "e12");
    e5Id = await depositDraft(request, f.c.k1, recipeText(marker("e12e5")));
    await ageDraft(e5Id, 8);
    e8Id = await depositDraft(request, f.c.danaKey, recipeText(marker("e12e8")), { on_behalf_of: f.c.pat.email });
    await ageDraft(e8Id, 8);
  });
  await test.step("axe scan of the queue with the expired line (E1)", async () => {
    await signIn(page, f.c.pat, "/app/dashboard");
    await openQueue(page);
    await expect(page.getByTestId("queue-expired"), "the queue should show the expired line").toContainText("expired unanswered");
    await shot(page, testInfo, "E12-01-axe-queue");
    await recordAxe(page, testInfo, "E12-E1-queue");
  });
  await test.step("axe scan of the expired listing (E2)", async () => {
    await followExpiredLink(page);
    await expect(page.getByTestId("queue-expired-item").first(), "the listing should show an expired item").toBeVisible();
    await recordAxe(page, testInfo, "E12-E2-expired-listing");
  });
  await test.step("axe scan of Pat's expired detail page (E5)", async () => {
    await openDetail(page, e5Id);
    await expect(page.getByTestId("draft-status"), "the detail page should show the expired line").toHaveText("Unverified draft, expired");
    await recordAxe(page, testInfo, "E12-E5-detail");
  });
  await test.step("axe scan of Dana's expired on-behalf detail page (E8)", async () => {
    const { context, page: dp } = await signInNewContext(browser, testInfo, f.c.dana, "/app/dashboard");
    await openDetail(dp, e8Id);
    await expect(dp.getByTestId("draft-status"), "Dana's page should show the expired line").toHaveText("Unverified draft, expired");
    await recordAxe(dp, testInfo, "E12-E8-dana-detail");
    await context.close();
  });
});

test("E13 (open): the web check page names a nearby open question", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e13");
  const m = marker("e13");
  // No parentheses: T is passed verbatim as filter, and the search grammar reads
  // "(...)" as an OR group (a parse error on the page).
  const text = `As a backend maintainer working on the review queue ${m}, I prefer small reviewed changes so that nothing ships unseen.`;
  let id = "";
  let depositedAt = "";
  await test.step("fixture: K1 deposits a draft with recipe text T", async () => {
    id = await depositDraft(request, c.k1, text);
    depositedAt = new Date().toISOString().slice(0, 10);
    note(testInfo, "E13 draft id", id);
  });
  await test.step("open /check?key=<K2>&filter=<T> in the browser (retrying while the embedding lands)", async () => {
    const url = `${BACKEND_URL}/check?${new URLSearchParams({ key: c.k2, filter: text }).toString()}`;
    let found = false;
    for (let attempt = 1; attempt <= 8 && !found; attempt++) {
      await page.goto(url);
      found = (await page.locator("#open-question").count()) > 0;
      note(testInfo, `E13 attempt ${attempt}`, found ? "open-question section present" : "no open-question section");
      if (!found) await page.waitForTimeout(2000);
    }
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(body.includes(c.k2), "the K2 key must not appear in the page's visible text").toBe(false);
    note(testInfo, "E13 page text (first 1500 chars)", body.slice(0, 1500));
    const resultsHeading = page.locator("#results h2");
    note(testInfo, "E13 results heading", (await resultsHeading.count()) ? await resultsHeading.innerText() : "(no results section)");
    const oq = page.locator("#open-question");
    const line = (await oq.count()) ? (await oq.innerText()).trim() : "(no open-question line)";
    note(testInfo, "E13 open-question line", line);
    const placement = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll("section[id]")).map((s) => s.id);
      return ids.join(" > ");
    });
    note(testInfo, "E13 section order", placement);
    await shotMasked(page, testInfo, "E13-01-check-page-open-question", [c.k1, c.k2]);
    const expected = `Open question near this call: ${id} (asked ${depositedAt}). If your context settles it, resolve it; otherwise leave it.`;
    expect.soft(line, `the page should show "${expected}"`).toBe(expected);
    if (await oq.count()) {
      const after = await page.evaluate(() => {
        const r = document.getElementById("results");
        const o = document.getElementById("open-question");
        return !!(r && o && r.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect.soft(after, "the open-question line should come after the results").toBe(true);
    }
  });
});
