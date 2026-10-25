import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, signInNewContext, type SeededUser } from "./helpers/accounts";
import { assertNoHorizontalScroll, shot } from "./helpers/evidence";
import { axeBeyondKnown } from "./drafts-known-issues";

// Slice 6c (agent-side resolution) browser run, PR #137: an agent resolves a
// draft (rejected / not chosen) and the detail page names the resolver.
// Expectations: claimNet docs/working/browser-verification/2026-10-24-drafts-6c/expectations.md.
// Kept as a regression test on merge; E7 follows ruling 56 and S4-M3.
// Cast: Pat (subject; keys K1 deposits, K2 a second ordinary key), Dana (member,
// deposits on Pat's behalf), Sam (owns the shared book).
// Fixtures (accounts, book, keys, deposits, the agent's resolve call) go through
// the API; every step a person takes and every page check goes through the browser.
// Accounts: e2e-p137-<test>-<role>-*@test.local.

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
  const pat = await seedUser(request, `p137-${label}-pat`);
  const dana = await seedUser(request, `p137-${label}-dana`);
  const sam = await seedUser(request, `p137-${label}-sam`);
  const orgId = (await booksOf(request, sam))[0]!.organization_id;
  const slug = `p137-${label}-${RUN}${++seq}`.toLowerCase();
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
    evidence: `Could not ask: the person is away.\n> "deposit quote ${text.slice(-60)}"\n-- drafts-slice6c.spec.ts deposit`,
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

/** The agent's resolve call: POST /recipes/:id/verify (fixture setup the expectations allow). */
async function agentResolve(request: APIRequestContext, key: string, id: string, quote: string, outcome?: "rejected" | "not_chosen"): Promise<void> {
  const data: Record<string, unknown> = {
    supporting_evidence: `The person answered when asked in the session.\n> "${quote}"\n-- drafts-slice6c.spec.ts session transcript ${RUN}`,
  };
  if (outcome) data["outcome"] = outcome;
  const res = await request.post(`${BACKEND_URL}/recipes/${id}/verify`, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    data,
  });
  const text = await res.text();
  expect(res.ok(), `fixture: resolving ${id} with outcome ${outcome ?? "(omitted, verified)"} should succeed; got ${res.status()} ${text.slice(0, 400)}`).toBe(true);
}

function note(testInfo: TestInfo, type: string, description: string) {
  testInfo.annotations.push({ type, description });
}

async function openDetail(page: Page, id: string) {
  await page.goto(`/app/traces/${id}`);
  await expect(page.getByText(/Loading trace/), "the detail page should finish loading").toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 }), "the detail page should render the recipe heading").toBeVisible();
}

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

test.afterEach(async ({}, testInfo) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    testInfo.outputPath("annotations.json"),
    JSON.stringify({ title: testInfo.title, project: testInfo.project.name, status: testInfo.status, errors: testInfo.errors.map((e) => e.message), annotations: testInfo.annotations }, null, 2),
  );
});

// ──────────────────────────────────────────────────────────────────────────

test("E1: an agent of Pat's (not the depositing key) rejects his draft, and the detail page names the agent", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e1");
  const m = marker("e1");
  const quote = `rejected by K2 ${m}`;
  let id = "";
  await test.step("K1 deposits a draft", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
  });
  await test.step("K2 rejects it through POST /recipes/:id/verify with outcome rejected", async () => {
    await agentResolve(request, c.k2, id, quote, "rejected");
  });

  const check = async (when: string, shotName: string) => {
    const date = await today(page);
    const status = page.getByTestId("draft-status");
    await expect(status, `${when}: the status line should read "Rejected draft (by your agent on ${date})"`).toHaveText(`Rejected draft (by your agent on ${date})`);
    const title = (await status.getAttribute("title")) ?? "";
    expect(title, `${when}: the title should say an agent of Pat's rejected the draft`).toMatch(/agent of yours rejected this draft/i);
    expect(title, `${when}: the title should say its evidence below says why`).toMatch(/evidence below says why/i);
    expect(await status.innerText(), `${when}: the status line should not say "You marked this draft wrong"`).not.toContain("You marked this draft wrong");
    expect(title, `${when}: the title should not say "You marked this draft wrong"`).not.toContain("You marked this draft wrong");
    await expect(page.getByText(quote).first(), `${when}: K2's quoted evidence should appear in the evidence section`).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence" }), `${when}: the evidence section should render`).toBeVisible();
    await recordStatus(page, testInfo, when);
    await shot(page, testInfo, shotName);
  };

  await test.step("Pat opens the draft's detail page", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, id);
    await check("E1 first open", "E1-01-detail-rejected-by-your-agent");
  });
  await test.step("Pat reloads it", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }), "the detail page should render after reload").toBeVisible();
    await check("E1 after reload", "E1-02-after-reload");
  });
});

test("E2: the depositing key rejects its own draft", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e2");
  const m = marker("e2");
  let id = "";
  await test.step("K1 deposits a draft", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
  });
  await test.step("K1 rejects it with outcome rejected", async () => {
    await agentResolve(request, c.k1, id, `rejected by K1 itself ${m}`, "rejected");
  });
  await test.step("Pat opens the detail page", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, id);
    const date = await today(page);
    await expect(page.getByTestId("draft-status"), `the line should read "Rejected draft (by the agent that deposited it on ${date})"`).toHaveText(`Rejected draft (by the agent that deposited it on ${date})`);
    await recordStatus(page, testInfo, "E2");
    await shot(page, testInfo, "E2-01-detail-rejected-by-depositing-agent");
  });
});

test("E3: an agent marks a draft not chosen", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e3");
  const m = marker("e3");
  let id = "";
  await test.step("K1 deposits a draft", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
  });
  await test.step("K2 resolves it with outcome not_chosen", async () => {
    await agentResolve(request, c.k2, id, `not chosen by K2 ${m}`, "not_chosen");
  });
  const check = async (when: string) => {
    const date = await today(page);
    const status = page.getByTestId("draft-status");
    await expect(status, `${when}: the line should read "Draft not chosen (by your agent on ${date})"`).toHaveText(`Draft not chosen (by your agent on ${date})`);
    const title = (await status.getAttribute("title")) ?? "";
    expect(title, `${when}: the title should say an agent of Pat's marked this option not chosen`).toMatch(/agent of yours marked this option not chosen/i);
    expect(title, `${when}: the title should say its evidence below says why`).toMatch(/evidence below says why/i);
    await recordStatus(page, testInfo, when);
  };
  await test.step("Pat opens the detail page", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, id);
    await check("E3 first open");
    await shot(page, testInfo, "E3-01-detail-not-chosen-by-your-agent");
  });
  await test.step("Pat reloads it", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }), "the detail page should render after reload").toBeVisible();
    await check("E3 after reload");
  });
});

test("E4: Pat rejects a draft himself with the Wrong reaction (control for E1)", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e4");
  const m = marker("e4");
  let id = "";
  await test.step("K1 deposits a draft", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
  });
  await test.step("Pat opens its detail page and clicks Wrong", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, id);
    await expect(page.getByTestId("draft-status"), "before the reaction the draft should be unverified").toHaveText("Unverified draft");
    await shot(page, testInfo, "E4-01-before-wrong");
    await page.getByRole("button", { name: /^Wrong/ }).click();
    await expect(page.getByTestId("draft-status"), "after Wrong the line should say the draft is rejected").toHaveText(/^Rejected draft/);
    await recordStatus(page, testInfo, "E4 right after Wrong");
  });
  await test.step("Pat reloads the page", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }), "the detail page should render after reload").toBeVisible();
    const date = await today(page);
    const status = page.getByTestId("draft-status");
    await expect(status, `the line should read "Rejected draft (by you on ${date})"`).toHaveText(`Rejected draft (by you on ${date})`);
    expect((await status.getAttribute("title")) ?? "", 'the title should contain "You marked this draft wrong"').toContain("You marked this draft wrong");
    await recordStatus(page, testInfo, "E4 after reload");
    await shot(page, testInfo, "E4-02-after-wrong-by-you");
  });
});

test("E5: Pat rejects a draft from the review queue", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e5");
  const m = marker("e5");
  let id = "";
  await test.step("K1 deposits a draft", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
  });
  await test.step("Pat opens /app/drafts, finds it and rejects it", async () => {
    await signIn(page, c.pat, "/app/drafts");
    await expect(page.getByRole("heading", { level: 1, name: /drafts/i }), "the queue should render its heading").toBeVisible();
    await expect(page.getByText("Loading…"), "the queue should finish loading").toHaveCount(0);
    const item = page.getByTestId("queue-item").filter({ hasText: m });
    await expect(item, "the draft should be in Pat's queue").toHaveCount(1);
    await shot(page, testInfo, "E5-01-queue-before-reject");
    await item.getByRole("button", { name: /^Reject/ }).click();
    await expect(page.getByRole("status"), "the queue should announce the rejection").toContainText("Rejected");
  });
  await test.step("Pat opens the draft's detail page", async () => {
    await openDetail(page, id);
    const date = await today(page);
    await expect(page.getByTestId("draft-status"), `the line should read "Rejected draft (by you on ${date})"`).toHaveText(`Rejected draft (by you on ${date})`);
    await recordStatus(page, testInfo, "E5 detail");
    await shot(page, testInfo, "E5-02-detail-by-you");
  });
});

test("E6: list rows name no resolver", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e6");
  const m = { rej: marker("e6rejected"), nc: marker("e6notchosen"), ver: marker("e6verified") };
  const ids: Record<string, string> = {};
  await test.step("fixture: three drafts by K1 in the shared book; K2 rejects one, marks one not chosen, verifies one", async () => {
    ids["rej"] = await depositDraft(request, c.k1, recipeText(m.rej));
    ids["nc"] = await depositDraft(request, c.k1, recipeText(m.nc));
    ids["ver"] = await depositDraft(request, c.k1, recipeText(m.ver));
    await agentResolve(request, c.k2, ids["rej"]!, `rejected by K2 ${m.rej}`, "rejected");
    await agentResolve(request, c.k2, ids["nc"]!, `not chosen by K2 ${m.nc}`, "not_chosen");
    await agentResolve(request, c.k2, ids["ver"]!, `verified by K2 ${m.ver}`);
  });

  const checkRows = async (where: string, rowOf: (k: string) => ReturnType<Page["locator"]>) => {
    for (const [k, label] of [["rej", "[Rejected draft]"], ["nc", "[Draft not chosen]"]] as const) {
      const row = rowOf(m[k]);
      await expect(row, `${where}: the ${k} draft should be listed`).toHaveCount(1);
      await expect(row.getByTestId("draft-status"), `${where}: the ${k} row should show exactly "${label}"`).toHaveText(label);
    }
    const verRow = rowOf(m.ver);
    await expect(verRow, `${where}: the verified draft should be listed`).toHaveCount(1);
    const verLabel = verRow.getByTestId("draft-status");
    const verText = (await verLabel.count()) ? await verLabel.innerText() : "(no bracketed label)";
    note(testInfo, `${where} verified row label (open question)`, verText);
    if (await verLabel.count()) expect(verText, `${where}: if the verified row has a label it should read exactly "[Verified draft]"`).toBe("[Verified draft]");
    for (const k of ["rej", "nc", "ver"] as const) {
      const l = rowOf(m[k]).getByTestId("draft-status");
      if (await l.count()) {
        const t = await l.innerText();
        note(testInfo, `${where} ${k} row label`, t);
        expect(t, `${where}: the ${k} row's label should not contain "by "`).not.toContain("by ");
      }
    }
  };

  await test.step("Pat opens his dashboard", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" }), "the dashboard should load").toBeVisible();
    await expect(page.getByText(m.ver), "the dashboard log should list the recipes").toBeVisible();
    await checkRows("dashboard", (k) => page.locator("a[href^='/app/traces/']").filter({ hasText: k }));
    await shot(page, testInfo, "E6-01-dashboard-rows");
  });
  await test.step("Pat opens the shared book's page", async () => {
    await page.goto(`/app/recipe-books/${c.bookId}/traces`);
    await expect(page.getByRole("heading", { level: 1 }), "the book's page should render its heading").toBeVisible();
    await expect(page.getByText(/Loading/), "the list should finish loading").toHaveCount(0);
    await expect(page.getByText(m.ver), "the book page should list the recipes").toBeVisible();
    await checkRows("book page", (k) => page.locator("a[href^='/app/traces/']").filter({ hasText: k }));
    await shot(page, testInfo, "E6-02-book-page-rows");
  });
});

test("E7: a depositor's view of a draft about someone else that was rejected", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e7");
  const m = marker("e7");
  let id = "";
  await test.step("Dana's key deposits a draft about Pat in the shared book", async () => {
    id = await depositDraft(request, c.danaKey, recipeText(m), { on_behalf_of: c.pat.email });
  });
  await test.step("Pat's K2 rejects it with outcome rejected", async () => {
    await agentResolve(request, c.k2, id, `rejected by K2 for Dana's draft ${m}`, "rejected");
  });
  await test.step("Dana opens its detail page", async () => {
    await signIn(page, c.dana, "/app/dashboard");
    await openDetail(page, id);
    const date = await today(page);
    const status = page.getByTestId("draft-status");
    await recordStatus(page, testInfo, "E7 Dana");
    await shot(page, testInfo, "E7-01-dana-detail-rejected");
    const text = await status.innerText();
    expect(text, 'the line should not carry a "by …" clause').not.toMatch(/\bby\b/);
    const title = (await status.getAttribute("title")) ?? "";
    expect(title, `the title should say "${c.pat.email} rejected this draft"`).toContain(`${c.pat.email} rejected this draft`);
    expect(title, "the title should say it stays private to them and to her").toMatch(/stays private to them and to you/);
    const main = await page.locator("main").innerText();
    note(testInfo, "E7 Dana main text", main.replace(/\s+/g, " ").slice(0, 900));
    expect(main, "nothing on the page should name K2 as the resolver").not.toContain("K2 Pat second agent");
    expect(main, "nothing on the page should say 'by your agent' or 'by the agent that deposited it'").not.toMatch(/by your agent|by the agent that deposited it|by you\b/);
    // S4-M3: the resolution date is the subject's alone, so the depositor's
    // line has no date (the 2026-10-24 run's expectation asked for one in error).
    await expect(status, 'the line should read "Rejected draft", with no date').toHaveText("Rejected draft");
    expect(text, `the line should not carry the resolution date ${date}`).not.toContain(date);
    // Ruling 56: the rejected draft stays Dana's, so she reads the evidence
    // Pat's agent attached, which says why her hypothesis did not hold.
    await expect(page.getByText(`rejected by K2 for Dana's draft ${m}`).first(), "Dana should see the rejecting agent's quoted evidence").toBeVisible();
  });
});

test("E8: an unresolved draft is unchanged (control)", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e8");
  const m = marker("e8");
  let id = "";
  await test.step("K1 deposits a draft", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
  });
  await test.step("Pat opens its detail page", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, id);
    await expect(page.getByTestId("draft-status"), 'the line should read "Unverified draft"').toHaveText("Unverified draft");
    await expect(page.getByRole("button", { name: /^Still true/ }), "the Still true reaction should be offered").toBeVisible();
    await expect(page.getByRole("button", { name: /^Wrong/ }), "the Wrong reaction should be offered").toBeVisible();
    await recordStatus(page, testInfo, "E8");
    await shot(page, testInfo, "E8-01-unverified-unchanged");
  });
});

test("E9: phone width, the longest new line fits @mobile", async ({ page, request }, testInfo) => {
  const c = await setupCast(request, "e9");
  const m = marker("e9");
  let id = "";
  await test.step("fixture (as E2): K1 deposits a draft and rejects it itself", async () => {
    id = await depositDraft(request, c.k1, recipeText(m));
    await agentResolve(request, c.k1, id, `rejected by K1 itself ${m}`, "rejected");
  });
  await test.step("Pat opens E2's detail page", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, id);
    const vw = page.viewportSize()!.width;
    note(testInfo, "E9 viewport width", String(vw));
    if (testInfo.project.name === "mobile") expect(vw, "the mobile project should be 412px wide").toBe(412);
    const status = page.getByTestId("draft-status");
    const date = await today(page);
    await expect(status, "the longest new line should be shown").toHaveText(`Rejected draft (by the agent that deposited it on ${date})`);
    await status.scrollIntoViewIfNeeded();
    const box = (await status.boundingBox())!;
    note(testInfo, "E9 status box", JSON.stringify(box));
    expect(box.x, "the status line should start inside the screen").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `the status line should end inside the ${vw}px screen`).toBeLessThanOrEqual(vw);
    const clip = await status.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || "16")) }));
    note(testInfo, "E9 status scroll/client width and approx lines", JSON.stringify(clip));
    expect(clip.sw, "the status line's text should not be clipped (scrollWidth within clientWidth)").toBeLessThanOrEqual(clip.cw + 1);
    await assertNoHorizontalScroll(page, testInfo, "E9-detail");
    await shot(page, testInfo, "E9-01-mobile-longest-line", false);
  });
});

test("E10: accessibility of the detail pages in E1 and E7", async ({ page, request, browser }, testInfo) => {
  const c = await setupCast(request, "e10");
  const m1 = marker("e10pat");
  const m7 = marker("e10dana");
  let patId = "", danaId = "";
  await test.step("fixture: E1's draft (K1 deposits, K2 rejects) and E7's draft (Dana on Pat's behalf, K2 rejects)", async () => {
    patId = await depositDraft(request, c.k1, recipeText(m1));
    await agentResolve(request, c.k2, patId, `rejected by K2 ${m1}`, "rejected");
    danaId = await depositDraft(request, c.danaKey, recipeText(m7), { on_behalf_of: c.pat.email });
    await agentResolve(request, c.k2, danaId, `rejected by K2 ${m7}`, "rejected");
  });
  await test.step("axe scan of Pat's detail page (E1)", async () => {
    await signIn(page, c.pat, "/app/dashboard");
    await openDetail(page, patId);
    await expect(page.getByTestId("draft-status"), "Pat's page should show the rejected line").toHaveText(/^Rejected draft \(by your agent/);
    await shot(page, testInfo, "E10-01-axe-detail");
    await recordAxe(page, testInfo, "E10-E1-pat-detail");
  });
  await test.step("axe scan of Dana's detail page (E7)", async () => {
    const { context, page: dp } = await signInNewContext(browser, testInfo, c.dana, "/app/dashboard");
    await openDetail(dp, danaId);
    await expect(dp.getByTestId("draft-status"), "Dana's page should show the rejected line").toHaveText(/^Rejected draft/);
    await recordAxe(dp, testInfo, "E10-E7-dana-detail");
    await context.close();
  });
});
