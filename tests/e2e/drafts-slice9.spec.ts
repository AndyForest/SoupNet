import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, signInNewContext, type SeededUser } from "./helpers/accounts";
import { assertNoHorizontalScroll, shot } from "./helpers/evidence";
import { axeBeyondKnown } from "./drafts-known-issues";

// Slice 9 (read paths for reports) browser run, verifier agent, 2026-10-24:
// the intent id on feedback rows and the intent page /app/intents/:id.
// Expectations E1-E9 come from the slice 9 rubric rows S9-W1 and S9-W2
// (docs/planning/drafts-and-triage-build.md); the results are in that file's
// slice 9 fix pass. Kept as a regression test with the change (recipes
// 840d65ab, dfb89586).
// Cast: Pat (owns the intent and a scoped key), Olive (a second person, E5 only).

const KEY_LABEL = "Pat slice9 agent";
const AGENT_ID = "drafts-slice9-agent";

interface Fixture {
  pat: SeededUser;
  key: string;
  bookId: string;
  recipeId: string;
  recipeText: string;
  intentId: string;
  intentStory: string;
}

let seq = 0;
function tag(): string {
  seq += 1;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}-${seq}`;
}

async function body(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Pat, a scoped key on his personal book, and one recipe deposited under a new intent. */
async function setup(request: APIRequestContext): Promise<Fixture> {
  const pat = await seedUser(request, "s9-pat");
  const books = (await body(await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(pat) })))["data"] as Array<{ id: string }>;
  const bookId = books[0]!.id;
  const mint = await request.post(`${BACKEND_URL}/keys/scoped`, {
    headers: asUser(pat),
    data: {
      readRecipeBookIds: [bookId],
      writeRecipeBookIds: [bookId],
      defaultWriteRecipeBookId: bookId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      label: KEY_LABEL,
    },
  });
  const key = ((await body(mint))["data"] as { key?: string } | undefined)?.key ?? "";
  expect(key, `minting Pat's scoped key should succeed; got ${mint.status()}`).toBeTruthy();

  const t = tag();
  const recipeText = `As a backend maintainer working on report read paths (${t}), I prefer each feedback row to name the intent it reports on so that a person can follow one task from start to finish.`;
  const intentStory = `As a backend maintainer about to review the slice 9 intent page (${t}), I want my agent to trace one task's checks and feedback in order.`;
  const qs = new URLSearchParams({
    key,
    format: "json",
    recipe: recipeText,
    evidence: `The operator asked for this in the task brief.\n> "the intent id rendered and linked on each feedback row"\n-- slice 9 task brief`,
    intent: intentStory,
    agent_id: AGENT_ID,
  });
  const res = await request.get(`${BACKEND_URL}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
  const b = await body(res);
  expect(res.ok(), `the check that registers the intent should succeed; got ${res.status()} ${JSON.stringify(b).slice(0, 300)}`).toBe(true);
  const data = b["data"] as { checked?: { recipeId?: string }; intentId?: string };
  const recipeId = data.checked?.recipeId ?? "";
  const intentId = data.intentId ?? "";
  expect(recipeId, "the check should return the deposited recipe's id").toBeTruthy();
  expect(intentId, "the check should return an intent id of the form int_ + 24 characters").toMatch(/^int_[A-Za-z0-9]{24}$/);
  return { pat, key, bookId, recipeId, recipeText, intentId, intentStory };
}

interface FeedbackOpts {
  traceId?: string;
  searchId?: string;
  intentId?: string;
  story: string;
  note: string;
}

async function postFeedback(request: APIRequestContext, key: string, o: FeedbackOpts): Promise<void> {
  const data: Record<string, unknown> = {
    kind: "check-feedback",
    impact: "subtle",
    disposition: "proceeded",
    story_fulfilled: "yes",
    story: o.story,
    note: o.note,
    agent_id: AGENT_ID,
  };
  if (o.traceId) data["trace_id"] = o.traceId;
  if (o.searchId) data["search_id"] = o.searchId;
  if (o.intentId) data["intent_id"] = o.intentId;
  const res = await request.post(`${BACKEND_URL}/feedback`, { headers: { Authorization: `Bearer ${key}` }, data });
  const text = await res.text();
  expect(res.ok(), `posting a feedback row should succeed; got ${res.status()} ${text.slice(0, 300)}`).toBe(true);
}

const WITH_INTENT = {
  story: "The check surfaced the earlier decision about report shapes, so I kept the existing paging.",
  note: "Row carrying the intent id (E1).",
};
const WITHOUT_INTENT = {
  story: "I proceeded without reading the related recipes; nothing on topic came back.",
  note: "Row without an intent id (E2 control).",
};

/** The feedback card whose story paragraph reads `story` (the story <p> sits directly in the card). */
function cardByStory(page: Page, story: string): Locator {
  return page.getByText(story, { exact: true }).locator("xpath=..");
}

async function openDetail(page: Page, recipeId: string, recipeText: string) {
  await expect(page, "the recipe's detail page should open at its URL").toHaveURL(new RegExp(`/app/traces/${recipeId}`));
  await expect(page.getByRole("heading", { level: 1 }), "the detail page should show the recipe's text as its heading").toHaveText(recipeText);
  await expect(page.getByRole("heading", { name: /^Feedback \(\d+\)$/ }), "the detail page should show its Feedback section").toBeVisible();
}

async function waitIntentPage(page: Page, f: Fixture) {
  await expect(page.getByTestId("intent-page"), "the intent page should render").toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }), "the intent page should show the intent's story as its heading").toHaveText(f.intentStory);
}

// ---------------------------------------------------------------------------

test("E1 a feedback row carrying an intent id shows it, linked to the intent page", async ({ page, request }, testInfo) => {
  const f = await setup(request);
  await test.step("Pat's agent logs a feedback row carrying the intent id", async () => {
    await postFeedback(request, f.key, { traceId: f.recipeId, intentId: f.intentId, ...WITH_INTENT });
  });
  await test.step("Pat opens the recipe's detail page", async () => {
    await signIn(page, f.pat, `/app/traces/${f.recipeId}`);
    await openDetail(page, f.recipeId, f.recipeText);
  });
  await test.step("the row shows the intent id, short, with the full id on hover, linked to its page", async () => {
    const card = cardByStory(page, WITH_INTENT.story);
    const line = card.getByTestId("feedback-intent");
    await expect(line, "the feedback row should show an intent line").toBeVisible();
    const link = line.getByRole("link");
    await expect(link, "the intent id should be a link").toBeVisible();
    const shown = (await link.innerText()).trim();
    testInfo.annotations.push({ type: "observed", description: `intent link text: "${shown}"; full id ${f.intentId}` });
    expect(shown, "the link text should be a short form of the id beginning int_").toMatch(/^int_/);
    expect(shown.length, "the short form should be shorter than the full id").toBeLessThan(f.intentId.length);
    expect(f.intentId.startsWith(shown.replace(/…$/, "")), "the short form should be a prefix of the full intent id").toBe(true);
    await expect(link, "the full intent id should be in the link's title (shown on hover)").toHaveAttribute("title", f.intentId);
    await expect(link, "the link should point at /app/intents/<full id>").toHaveAttribute("href", `/app/intents/${f.intentId}`);
    await link.hover();
    await shot(page, testInfo, "E1-01-detail-feedback-with-intent");
  });
});

test("E2 a feedback row without an intent id looks as before", async ({ page, request }, testInfo) => {
  const f = await setup(request);
  await test.step("two feedback rows on the same recipe: one with the intent id, one without", async () => {
    await postFeedback(request, f.key, { traceId: f.recipeId, intentId: f.intentId, ...WITH_INTENT });
    await postFeedback(request, f.key, { traceId: f.recipeId, ...WITHOUT_INTENT });
  });
  await test.step("open the detail page", async () => {
    await signIn(page, f.pat, `/app/traces/${f.recipeId}`);
    await openDetail(page, f.recipeId, f.recipeText);
  });
  await test.step("the row without one has no intent line, and keeps its chips, story, note and star", async () => {
    const card = cardByStory(page, WITHOUT_INTENT.story);
    await expect(card, "the row without an intent id should render").toBeVisible();
    await expect(card.getByTestId("feedback-intent"), "a row without an intent id should show no intent line").toHaveCount(0);
    await expect(card.getByText(/Intent:/), "a row without an intent id should show no 'Intent:' text").toHaveCount(0);
    await expect(card.locator('a[href^="/app/intents/"]'), "a row without an intent id should have no intent link").toHaveCount(0);
    for (const chip of ["impact", "disposition", "kind", "fulfilled"]) {
      await expect(card.getByText(chip, { exact: true }), `the row should still show its ${chip} chip`).toBeVisible();
    }
    await expect(card.getByText(WITHOUT_INTENT.note, { exact: true }), "the row should still show its note").toBeVisible();
    await expect(card.getByRole("button", { name: /[☆★]/ }), "the row should still offer the star button").toBeVisible();
    // The other row on the page still carries its intent line (so the absence above is not a page-wide gap).
    await expect(cardByStory(page, WITH_INTENT.story).getByTestId("feedback-intent"), "the intent-carrying row on the same page should show its intent line").toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E2-01-detail-feedback-without-intent");
  });
});

test("E3 following the intent link opens the intent page with story and lineage", async ({ page, request }, testInfo) => {
  const f = await setup(request);
  const first = { story: "First: the check surfaced a related report shape, so I kept paging.", note: "Earlier feedback row (E3)." };
  const second = { story: "Second: after the change I confirmed the read path returned the intent.", note: "Later feedback row (E3)." };
  await test.step("Pat's agent logs two feedback rows under the intent, one after the other", async () => {
    await postFeedback(request, f.key, { traceId: f.recipeId, intentId: f.intentId, ...first });
    await page.waitForTimeout(1100); // distinct timestamps, so the order is observable
    await postFeedback(request, f.key, { traceId: f.recipeId, intentId: f.intentId, ...second });
  });
  await test.step("from the detail page, click the intent link", async () => {
    await signIn(page, f.pat, `/app/traces/${f.recipeId}`);
    await openDetail(page, f.recipeId, f.recipeText);
    await cardByStory(page, first.story).getByTestId("feedback-intent").getByRole("link").click();
    await expect(page, "the URL should be /app/intents/<intent id>").toHaveURL(new RegExp(`/app/intents/${f.intentId}$`));
    await waitIntentPage(page, f);
  });
  await test.step("the header shows id, story, agent, key label, dates and counts", async () => {
    // The intent's own header (feedback cards below repeat agent and key in their footers).
    const pageEl = page.getByTestId("intent-page").locator("header");
    await expect(pageEl.getByText(f.intentId, { exact: true }), "the page should show the full intent id").toBeVisible();
    await expect(pageEl.getByText(`agent ${AGENT_ID}`), "the page should show the agent id the intent was registered with").toBeVisible();
    await expect(pageEl.getByText(`key: ${KEY_LABEL}`), "the page should show the key label the intent was registered with").toBeVisible();
    await expect(pageEl.getByText(/registered .+ · last used .+/), "the page should show the registered and last-used dates").toBeVisible();
    testInfo.annotations.push({ type: "observed", description: `header meta: "${(await pageEl.getByText(/registered/).innerText()).trim()}"` });
    const counts = page.getByTestId("intent-counts");
    await expect(counts, "the page should show counts of shown, deposited and feedback entries").toHaveText(/^\d+ shown · \d+ deposited · \d+ feedback$/);
    const countText = (await counts.innerText()).trim();
    testInfo.annotations.push({ type: "observed", description: `counts line: "${countText}"` });
    expect(countText, "the feedback count should include the two rows logged under this intent").toMatch(/ 2 feedback$/);
    await shot(page, testInfo, "E3-01-intent-page");
  });
  await test.step("the lineage lists entries oldest first, feedback rendered as on the detail page", async () => {
    const items = page.getByTestId("intent-page").locator("ol > li");
    const n = await items.count();
    expect(n, "the lineage should list at least the two feedback entries").toBeGreaterThanOrEqual(2);
    const heads: string[] = [];
    for (let i = 0; i < n; i++) heads.push((await items.nth(i).locator("p").first().innerText()).trim());
    testInfo.annotations.push({ type: "observed", description: `lineage entries in page order: ${heads.map((h, i) => `[${i + 1}] ${h}`).join(" | ")}` });

    // Order: compare the page with the API's timestamps (the page prints locale strings).
    const api = await request.get(`${BACKEND_URL}/me/intents/${f.intentId}?page=1`, { headers: asUser(f.pat) });
    const apiData = (await body(api))["data"] as { lineage: Array<{ type: string; at: string }> };
    const ats = apiData.lineage.map((e) => Date.parse(e.at));
    testInfo.annotations.push({ type: "observed", description: `lineage from GET /me/intents/:id: ${apiData.lineage.map((e) => `${e.type}@${e.at}`).join(", ")}` });
    expect(ats, "the lineage data the page renders should be in time order, oldest first").toEqual([...ats].sort((a, b) => a - b));
    expect(apiData.lineage.length, "the page should render every lineage entry the intent has (one page)").toBe(n);

    const firstIdx = await items.evaluateAll((els, s) => els.findIndex((el) => el.textContent?.includes(s)), first.story);
    const secondIdx = await items.evaluateAll((els, s) => els.findIndex((el) => el.textContent?.includes(s)), second.story);
    expect(firstIdx, "the earlier feedback row should appear in the lineage").toBeGreaterThanOrEqual(0);
    expect(secondIdx, "the earlier feedback row should be listed before the later one (oldest first)").toBeGreaterThan(firstIdx);

    const card = cardByStory(page, first.story);
    for (const chip of ["impact", "disposition", "kind", "fulfilled"]) {
      await expect(card.getByText(chip, { exact: true }), `a feedback entry should show its ${chip} chip as on the detail page`).toBeVisible();
    }
    await expect(card.getByText(first.note, { exact: true }), "a feedback entry should show its note as on the detail page").toBeVisible();

    const recipeLinks = page.getByTestId("intent-page").locator(`ol a[href="/app/traces/${f.recipeId}"]`);
    expect(await recipeLinks.count(), "a recipe id in the lineage should link to /app/traces/<id>").toBeGreaterThanOrEqual(1);
    await items.first().scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E3-02-intent-lineage");
  });
});

test("E4 a recipe id on the intent page leads back to the recipe", async ({ page, request }, testInfo) => {
  const f = await setup(request);
  await postFeedback(request, f.key, { traceId: f.recipeId, intentId: f.intentId, ...WITH_INTENT });
  await test.step("open the intent page", async () => {
    await signIn(page, f.pat, `/app/intents/${f.intentId}`);
    await waitIntentPage(page, f);
  });
  await test.step("click the link of the recipe the feedback is about", async () => {
    const feedbackItem = page.getByTestId("intent-page").locator("ol > li").filter({ hasText: WITH_INTENT.story });
    const link = feedbackItem.locator(`a[href="/app/traces/${f.recipeId}"]`).first();
    await expect(link, "the feedback entry should link the recipe it is about").toBeVisible();
    await link.click();
    await openDetail(page, f.recipeId, f.recipeText);
    await shot(page, testInfo, "E4-01-back-to-recipe");
  });
});

test("E5 another person's, a missing and a malformed intent id all give the same 'Intent not found'", async ({ page, request, browser }, testInfo) => {
  const f = await setup(request);
  await postFeedback(request, f.key, { traceId: f.recipeId, intentId: f.intentId, ...WITH_INTENT });
  const olive = await seedUser(request, "s9-olive");

  await test.step("control: Pat opens his own intent and sees the page", async () => {
    await signIn(page, f.pat, `/app/intents/${f.intentId}`);
    await waitIntentPage(page, f);
  });

  const { context, page: op } = await signInNewContext(browser, testInfo, olive, "/app/dashboard");
  const seen: string[] = [];
  const cases: Array<[string, string]> = [
    [`/app/intents/${f.intentId}`, "E5-01-foreign"],
    ["/app/intents/int_AAAAAAAAAAAAAAAAAAAAAAAA", "E5-02-missing"],
    ["/app/intents/not-an-intent", "E5-03-malformed"],
  ];
  for (const [path, name] of cases) {
    await test.step(`Olive opens ${path}`, async () => {
      await op.goto(path);
      const nf = op.getByTestId("intent-not-found");
      await expect(nf, `${path} should show the "Intent not found" message`).toBeVisible();
      seen.push((await op.getByRole("main").innerText()).trim());
      await expect(op.getByText(f.intentStory), `${path} should not show Pat's story`).toHaveCount(0);
      await expect(op.getByTestId("intent-page"), `${path} should not render the intent page or any lineage`).toHaveCount(0);
      await expect(op.getByText(WITH_INTENT.story), `${path} should not show any of Pat's lineage`).toHaveCount(0);
      await shot(op, testInfo, name);
    });
  }
  await test.step("all three show the same message", async () => {
    testInfo.annotations.push({ type: "observed", description: `main text per case: ${seen.map((s) => JSON.stringify(s)).join(" | ")}` });
    expect(seen[1], "a missing intent should read the same as another person's").toBe(seen[0]);
    expect(seen[2], "a malformed id should read the same as another person's").toBe(seen[0]);
    expect(seen[0], "the message should say Intent not found").toContain("Intent not found");
  });
  await context.close();
});

test("E6 a feedback row about a search shows on the intent page, with no star and no links", async ({ page, request }, testInfo) => {
  const f = await setup(request);
  const searchRow = { story: "The search for report shapes returned my own earlier recipe; I reused its paging.", note: "Row about a search (E6)." };
  await test.step("a feedback row with search_id and Pat's intent id", async () => {
    const qs = new URLSearchParams({ key: f.key, format: "json", filter: "feedback rows intent report paging" });
    const res = await request.get(`${BACKEND_URL}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
    const b = await body(res);
    expect(res.ok(), `the read-only search should succeed; got ${res.status()}`).toBe(true);
    const searchId = (b["data"] as { searchId?: string }).searchId ?? "";
    expect(searchId, "the search should return a searchId").toBeTruthy();
    await postFeedback(request, f.key, { searchId, intentId: f.intentId, ...searchRow });
  });
  await test.step("open the intent page: the row reads 'about a search', offers no star, and links nowhere", async () => {
    await signIn(page, f.pat, `/app/intents/${f.intentId}`);
    await waitIntentPage(page, f);
    const item = page.getByTestId("intent-page").locator("ol > li").filter({ hasText: searchRow.story });
    await expect(item, "the search feedback row should appear in the lineage").toBeVisible();
    await expect(item.getByText(/^Feedback · .+ · about a search$/), "the row's heading line should say it is about a search").toBeVisible();
    await expect(item.getByRole("button", { name: /[☆★]/ }), "a row about a search has no recipe to star").toHaveCount(0);
    await expect(item.locator("a"), "the row should link neither a recipe (it has none) nor the intent page already open").toHaveCount(0);
    await item.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E6-01-search-feedback-on-intent-page");
  });
});

test("E7 reload keeps the intent page", async ({ page, request }, testInfo) => {
  const f = await setup(request);
  await postFeedback(request, f.key, { traceId: f.recipeId, intentId: f.intentId, ...WITH_INTENT });
  await test.step("open the intent page, then reload", async () => {
    await signIn(page, f.pat, `/app/intents/${f.intentId}`);
    await waitIntentPage(page, f);
    await page.reload();
    await expect(page, "the URL should stay on the intent page after reload").toHaveURL(new RegExp(`/app/intents/${f.intentId}$`));
    await waitIntentPage(page, f);
    await expect(page.getByTestId("intent-page").locator("ol > li").filter({ hasText: WITH_INTENT.story }), "the lineage should still show the feedback entry after reload").toBeVisible();
    await shot(page, testInfo, "E7-01-after-reload");
  });
});

test("E8 the intent page fits a phone @mobile", async ({ page, request }, testInfo) => {
  const f = await setup(request);
  await postFeedback(request, f.key, { traceId: f.recipeId, intentId: f.intentId, ...WITH_INTENT });
  await test.step("open the intent page", async () => {
    await signIn(page, f.pat, `/app/intents/${f.intentId}`);
    await waitIntentPage(page, f);
  });
  await test.step("no horizontal scroll; story and id wrap", async () => {
    await assertNoHorizontalScroll(page, testInfo, "intent-page");
    const vw = page.viewportSize()!.width;
    for (const [label, loc] of [
      ["story heading", page.getByRole("heading", { level: 1 })],
      ["intent id", page.getByTestId("intent-page").locator("code").first()],
    ] as const) {
      const box = await loc.boundingBox();
      expect(box, `the ${label} should be on the page`).not.toBeNull();
      expect.soft(box!.x + box!.width, `the ${label} should end inside the ${vw}px screen (wrap, not overflow)`).toBeLessThanOrEqual(vw);
    }
    await shot(page, testInfo, "E8-01-intent-page-mobile");
  });
});

test("E9 accessibility and keyboard on the intent link and intent page", async ({ page, request }, testInfo) => {
  const f = await setup(request);
  await postFeedback(request, f.key, { traceId: f.recipeId, intentId: f.intentId, ...WITH_INTENT });
  await test.step("axe scan of the detail page with an intent-carrying row", async () => {
    await signIn(page, f.pat, `/app/traces/${f.recipeId}`);
    await openDetail(page, f.recipeId, f.recipeText);
    const r = await axeBeyondKnown(page, testInfo, "E9-detail");
    expect(r.blocking, "the detail page, its intent link included, should have no serious or critical axe violation beyond the backlog's known ones").toEqual([]);
  });
  await test.step("Tab to the intent link and press Enter", async () => {
    const link = page.getByTestId("feedback-intent").getByRole("link");
    let reached = false;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      if (await link.evaluate((el) => el === document.activeElement)) { reached = true; break; }
    }
    expect(reached, "the intent link should be reachable with the Tab key").toBe(true);
    await shot(page, testInfo, "E9-01-keyboard-focus-on-intent-link", false);
    await page.keyboard.press("Enter");
    await expect(page, "Enter on the focused intent link should open the intent page").toHaveURL(new RegExp(`/app/intents/${f.intentId}$`));
    await waitIntentPage(page, f);
  });
  await test.step("axe scan of the intent page", async () => {
    const r = await axeBeyondKnown(page, testInfo, "E9-intent");
    expect(r.blocking, "the intent page (header, counts, lineage labels and links) should have no serious or critical axe violation beyond the backlog's known ones").toEqual([]);
  });
});
