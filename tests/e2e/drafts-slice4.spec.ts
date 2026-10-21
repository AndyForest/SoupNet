import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, signInNewContext, type SeededUser } from "./helpers/accounts";
import { horizontalOverflow, shot } from "./helpers/evidence";
import { axeBeyondKnown, KNOWN_HEADING_OVERFLOW, knownIssue } from "./drafts-known-issues";

// Browser verification: drafts-and-triage slice 4 (drafts on behalf of another person).
// Contract: claimNet docs/working/browser-verification/2026-09-27-drafts-slice4/expectations.md
// Cast: Pat (subject), Dana (depositor, key "Dana laptop agent"), Sam (owns the shared book).
// Regression test on main since the 2026-09-29 post-merge run (claimNet
// docs/working/browser-verification/2026-09-29-drafts-post-merge/results-regression.md).

const DANA_KEY_LABEL = "Dana laptop agent";
const PAT_KEY_LABEL = "Pat own agent";
const LONG_TOKEN = "averyveryverylongunbrokentokenwithnospacesorhyphensatalltoexercisewrappingonnarrowscreens";

interface Cast {
  pat: SeededUser;
  dana: SeededUser;
  sam: SeededUser;
  bookId: string;
  bookName: string;
  danaKey: string;
  patKey: string;
}

let seq = 0;
function recipeText(topic: string, long = false): string {
  seq += 1;
  const tag = `${topic}-${Date.now().toString(36)}-${seq}`;
  const base = `As a backend maintainer working on the review queue (${tag}), I prefer a colleague's judgment recorded as a draft so that they confirm it before anyone relies on it.`;
  return long ? `${base} The config key ${LONG_TOKEN} must stay readable on a phone.` : base;
}

async function json(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function setupCast(request: APIRequestContext, long = false): Promise<Cast> {
  const pad = long ? "-with-a-very-long-local-part-for-wrapping-checks" : "";
  const pat = await seedUser(request, `s4-pat${pad}`);
  const dana = await seedUser(request, `s4-dana${pad}`);
  const sam = await seedUser(request, `s4-sam${pad}`);

  const booksOf = async (u: SeededUser) => {
    const r = await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(u) });
    const b = (await json(r))["data"] as Array<{ id: string; organization_id: string }>;
    return b;
  };
  const samBooks = await booksOf(sam);
  const orgId = samBooks[0]!.organization_id;
  const slug = `s4-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const bookName = `Shared ${slug}`;
  const created = await request.post(`${BACKEND_URL}/recipe-books`, {
    headers: asUser(sam),
    data: { name: bookName, slug, organizationId: orgId },
  });
  expect(created.ok(), `Sam should be able to create a shared book; got ${created.status()}`).toBe(true);
  const bookId = ((await json(created))["data"] as { id: string }).id;
  for (const m of [pat, dana]) {
    const r = await request.post(`${BACKEND_URL}/recipe-books/${bookId}/members`, {
      headers: asUser(sam),
      data: { email: m.email, role: "member" },
    });
    expect(r.status(), `Sam should be able to add ${m.email} to the shared book`).toBe(201);
  }
  const mint = async (u: SeededUser, label: string) => {
    const personal = (await booksOf(u)).find((b) => b.id !== bookId)!.id;
    const r = await request.post(`${BACKEND_URL}/keys/scoped`, {
      headers: asUser(u),
      data: {
        readRecipeBookIds: [bookId, personal],
        writeRecipeBookIds: [bookId, personal],
        defaultWriteRecipeBookId: bookId,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        label,
      },
    });
    const key = ((await json(r))["data"] as { key?: string } | undefined)?.key ?? "";
    expect(key, `minting the key "${label}" should succeed; got ${r.status()}`).toBeTruthy();
    return key;
  };
  const danaKey = await mint(dana, DANA_KEY_LABEL);
  const patKey = await mint(pat, PAT_KEY_LABEL);
  return { pat, dana, sam, bookId, bookName, danaKey, patKey };
}

interface Deposit { id: string; text: string; notice: string; reviewUrl: string }

async function deposit(request: APIRequestContext, key: string, text: string, extra: Record<string, string>): Promise<Deposit> {
  const qs = new URLSearchParams({
    key,
    recipe: text,
    evidence: `The colleague said so in review.\n> "keep it a draft until confirmed"\n-- drafts-slice4.spec.ts`,
    format: "json",
    ...extra,
  });
  const res = await request.get(`${BACKEND_URL}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
  const body = await json(res);
  expect(res.ok(), `the deposit should succeed; got ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toBe(true);
  const data = body["data"] as { checked?: { recipeId?: string }; draftNotice?: string };
  const id = data.checked?.recipeId ?? "";
  expect(id, "the deposit should return the new recipe's id").toBeTruthy();
  const notice = data.draftNotice ?? "";
  const m = /https?:\/\/[^\s)"']*\/app\/drafts\?ids=[^\s)"'.,]+/.exec(notice);
  return { id, text, notice, reviewUrl: m?.[0] ?? "" };
}

const onBehalf = (request: APIRequestContext, cast: Cast, text: string, extra: Record<string, string> = {}) =>
  deposit(request, cast.danaKey, text, { on_behalf_of: cast.pat.email, ...extra });

function queueItem(page: Page, text: string) {
  return page.getByTestId("queue-item").filter({ hasText: text.slice(0, 120) });
}

// A second actor with the running project's device settings (shared helper).
async function newActorPage(page: Page, testInfo: TestInfo, user: SeededUser, path: string): Promise<Page> {
  return (await signInNewContext(page.context().browser()!, testInfo, user, path)).page;
}

async function waitDetail(p: Page) {
  await expect(p.getByRole("heading", { level: 1 }), "the recipe's detail page should render its heading").toBeVisible();
}

async function waitQueue(p: Page) {
  // Case-insensitive: the id-list heading is "Linked drafts" when a linked draft
  // is on-behalf. Changed on purpose after the slice 4 run, per
  // docs/planning/drafts-and-triage-build.md (depositor-facing copy, c40624d):
  // "The id-list heading says "Drafts your agent linked" only when every linked
  // draft was deposited by the viewer's own agent, and "Linked drafts" otherwise."
  await expect(p.getByRole("heading", { level: 1, name: /drafts/i }), "the drafts page should render its heading").toBeVisible();
  await expect(p.getByText("Loading…"), "the drafts list should finish loading").toHaveCount(0);
}

function note(testInfo: TestInfo, type: string, description: string) {
  testInfo.annotations.push({ type, description });
  console.log(`[${testInfo.title.slice(0, 3)}] ${type}: ${description}`);
}


// ───────────────────────────────────────────────────────────────────────────

test("E1: Pat's queue shows who deposited the draft", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const obo = await onBehalf(request, cast, recipeText("e1-obo"), { impact: "high", uncertainty: "low" });
  const own = await deposit(request, cast.patKey, recipeText("e1-own"), { draft: "true" });

  await test.step("Pat opens /app/drafts", async () => {
    await signIn(page, cast.pat, "/app/drafts");
    await waitQueue(page);
    await expect(page.getByTestId("queue-item"), "both drafts should be listed in Pat's queue").toHaveCount(2);
  });

  await test.step("the on-behalf item names Dana and her key, and labels the ratings as the depositing agent's", async () => {
    const item = queueItem(page, obo.text);
    await expect(item, "the on-behalf draft should be in Pat's queue").toHaveCount(1);
    await expect(item, "the on-behalf item should show Dana's email as its depositor, in text").toContainText(cast.dana.email);
    await expect(item, "the on-behalf item should show the key label 'Dana laptop agent'").toContainText(DANA_KEY_LABEL);
    await expect(item, "the on-behalf item's ratings should be worded as the depositing agent's").toContainText(/Depositing agent's ratings: impact high · uncertainty low/);
    note(testInfo, "on-behalf item text", (await item.innerText()).replace(/\s+/g, " "));
    await item.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E1-01-pat-queue-on-behalf-item");
  });

  await test.step("Pat's own draft shows no depositor email line", async () => {
    const item = queueItem(page, own.text);
    await expect(item, "Pat's own draft should be in his queue").toHaveCount(1);
    await expect(item, "Pat's own draft should not show a depositor email").not.toContainText(cast.dana.email);
    await expect(item.getByTestId("queue-party"), "Pat's own draft should have no 'deposited on your behalf' line").toHaveCount(0);
    note(testInfo, "own item text", (await item.innerText()).replace(/\s+/g, " "));
    await item.scrollIntoViewIfNeeded();
    await shot(page, testInfo, "E1-02-pat-own-draft-item");
  });

  await test.step("the queue and dashboard counts are 2", async () => {
    await expect(page.getByTestId("queue-total"), "the queue's total line should count 2").toContainText("2 drafts await your review");
    await page.goto("/app/dashboard");
    await expect(page.getByTestId("drafts-entry"), "the dashboard's drafts figure should count 2").toContainText("2 drafts await your review");
  });
});

test("E2: Pat's detail page for an unresolved on-behalf draft", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const obo = await onBehalf(request, cast, recipeText("e2"), { impact: "high", uncertainty: "low" });

  await test.step("Pat opens the draft's detail page from the queue", async () => {
    await signIn(page, cast.pat, "/app/drafts");
    await waitQueue(page);
    await queueItem(page, obo.text).getByRole("link", { name: /Open recipe/ }).click();
    await expect(page, "the queue's link should open the recipe's detail page").toHaveURL(new RegExp(`/app/traces/${obo.id}`));
    await waitDetail(page);
  });

  await test.step("the page says unverified draft, names Dana as depositor, and offers confirm and reject", async () => {
    await expect(page.getByTestId("draft-status"), "the page should say it is an unverified draft").toHaveText("Unverified draft");
    await expect(page.getByTestId("draft-party"), "the page should name Dana's email as who deposited it, in text").toContainText(cast.dana.email);
    note(testInfo, "party line", await page.getByTestId("draft-party").innerText());
    await expect(page.getByRole("button", { name: /^Still true/ }), "Pat should have the confirm action (Still true)").toBeEnabled();
    await expect(page.getByRole("button", { name: /^Wrong/ }), "Pat should have the reject action (Wrong)").toBeEnabled();
    await shot(page, testInfo, "E2-01-pat-detail-deposited-by");
  });
});

test("E3: Dana's detail page shows state, whom it is about, delete only", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const obo = await onBehalf(request, cast, recipeText("e3"));

  await test.step("Dana opens the detail page of her draft about Pat", async () => {
    await signIn(page, cast.dana, `/app/traces/${obo.id}`);
    await waitDetail(page);
  });

  await test.step("state and 'about' in text; no confirm, reject or move; a named delete control", async () => {
    await expect(page.getByTestId("draft-status"), "Dana's page should say it is an unverified draft").toHaveText("Unverified draft");
    await expect(page.getByTestId("draft-party"), "Dana's page should say the draft is about Pat's email, in text").toContainText(cast.pat.email);
    note(testInfo, "party line", await page.getByTestId("draft-party").innerText());
    await expect(page.getByRole("button", { name: /^(Still true|Wrong|Stale)/ }), "Dana should have no confirm or reject control").toHaveCount(0);
    await expect(page.getByRole("button", { name: /Move/ }), "Dana should have no move control").toHaveCount(0);
    const del = page.getByRole("button", { name: /Delete/ });
    await expect(del, "Dana should have a delete control").toHaveCount(1);
    const name = (await del.getAttribute("aria-label")) ?? (await del.innerText());
    note(testInfo, "delete accessible name", name);
    expect(name.includes(cast.pat.email) || name.includes(obo.text.slice(0, 40)), "the delete control's accessible name should say what it removes (about Pat, or the recipe text)").toBe(true);
    await shot(page, testInfo, "E3-01-dana-detail-about-pat");
  });
});

test("E4: Dana deletes her draft and it leaves Pat's queue", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  await onBehalf(request, cast, recipeText("e4-first"));
  const second = await onBehalf(request, cast, recipeText("e4-second"));
  const patPage = await newActorPage(page, testInfo, cast.pat, "/app/drafts");

  await test.step("control: Pat's queue lists the second draft before the delete", async () => {
    await waitQueue(patPage);
    await expect(queueItem(patPage, second.text), "before the delete, Pat's queue should list Dana's second draft").toHaveCount(1);
    await shot(patPage, testInfo, "E4-01-before-delete-pat-queue");
  });

  await test.step("Dana opens the draft and deletes it through the UI", async () => {
    await signIn(page, cast.dana, `/app/traces/${second.id}`);
    await waitDetail(page);
    await page.getByRole("button", { name: /Delete/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog, "a confirmation dialog should open").toBeVisible();
    await dialog.getByRole("textbox").last().fill("DELETE");
    await dialog.getByRole("button", { name: /^Delete$/ }).click();
    await expect(dialog, "the dialog should close once the delete succeeds").toHaveCount(0);
    await page.waitForLoadState("networkidle");
    note(testInfo, "Dana landed on", page.url());
    await expect(page, "Dana should leave the deleted draft's page").not.toHaveURL(new RegExp(second.id));
    await shot(page, testInfo, "E4-02-dana-after-delete");
  });

  await test.step("Pat reloads his queue: the draft is gone", async () => {
    await patPage.reload();
    await waitQueue(patPage);
    await expect(queueItem(patPage, second.text), "after the delete, Pat's queue should no longer list the draft").toHaveCount(0);
    await shot(patPage, testInfo, "E4-03-pat-queue-after-delete");
  });
  await patPage.context().close();
});

test("E5: Dana's id-list link has no actions and names who reviews", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const obo = await onBehalf(request, cast, recipeText("e5"));
  note(testInfo, "draft notice", obo.notice);
  expect(obo.reviewUrl, "the deposit's notice should carry a /app/drafts?ids= review link").toContain(`/app/drafts?ids=${obo.id}`);
  const path = new URL(obo.reviewUrl).pathname + new URL(obo.reviewUrl).search;

  await test.step("Dana opens the review link", async () => {
    await signIn(page, cast.dana, path);
    await waitQueue(page);
    const item = queueItem(page, obo.text);
    await expect(item, "Dana should see the draft in the link view").toHaveCount(1);
    for (const n of [/^Confirm/, /^Reject/, /^Not chosen/]) {
      await expect(item.getByRole("button", { name: n, disabled: false }), `Dana should have no enabled ${n.source} button`).toHaveCount(0);
    }
    const group = item.getByRole("group");
    const describedBy = await group.getAttribute("aria-describedby");
    note(testInfo, "action group aria-describedby", String(describedBy));
    expect(describedBy, "the reason should be associated with the action group").toBeTruthy();
    const reason = page.locator(`#${describedBy}`);
    await expect(reason, "the reason should name Pat's email as who can review it").toContainText(cast.pat.email);
    note(testInfo, "reason text", await reason.innerText());
    note(testInfo, "Dana item text", (await item.innerText()).replace(/\s+/g, " "));
    await shot(page, testInfo, "E5-01-dana-link-no-actions");
  });

  await test.step("Pat opens the same link and has the actions", async () => {
    const patPage = await newActorPage(page, testInfo, cast.pat, path);
    await waitQueue(patPage);
    const item = queueItem(patPage, obo.text);
    await expect(item, "Pat should see the same draft").toHaveCount(1);
    await expect(item.getByRole("button", { name: /^Confirm/ }), "Pat should have the confirm action").toBeEnabled();
    await expect(item.getByRole("button", { name: /^Reject/ }), "Pat should have the reject action").toBeEnabled();
    await shot(patPage, testInfo, "E5-02-pat-link-actions");
    await patPage.context().close();
  });
});

test("E6: Dana's own queue does not hold drafts she deposited about Pat", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  await onBehalf(request, cast, recipeText("e6"));

  await test.step("Dana opens /app/drafts", async () => {
    await signIn(page, cast.dana, "/app/drafts");
    await waitQueue(page);
    await expect(page.getByTestId("queue-empty"), "Dana's queue should show the empty state").toBeVisible();
    await expect(page.getByTestId("queue-item"), "Dana's queue should list no items").toHaveCount(0);
    await shot(page, testInfo, "E6-01-dana-queue-empty");
  });

  await test.step("Dana opens her dashboard", async () => {
    await page.goto("/app/dashboard");
    await expect(page.getByRole("main"), "the dashboard should render").toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("drafts-entry"), "Dana's dashboard should show no drafts figure").toHaveCount(0);
    await shot(page, testInfo, "E6-02-dana-dashboard");
  });
});

async function confirmFromQueue(page: Page, text: string) {
  await waitQueue(page);
  const item = queueItem(page, text);
  await item.getByRole("button", { name: /^Confirm/ }).click();
  await expect(page.getByRole("status"), "the queue should announce the confirmation").toContainText("Confirmed");
}

test("E7: after Pat confirms, it is Pat's ordinary recipe for everyone", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const obo = await onBehalf(request, cast, recipeText("e7"));

  await test.step("Pat confirms from his queue and opens the detail page", async () => {
    await signIn(page, cast.pat, "/app/drafts");
    await confirmFromQueue(page, obo.text);
    await page.goto(`/app/traces/${obo.id}`);
    await waitDetail(page);
    const header = page.locator("header").first();
    note(testInfo, "Pat header text", (await header.innerText()).replace(/\s+/g, " "));
    const status = page.getByTestId("draft-status");
    if (await status.count()) note(testInfo, "Pat's verified label", await status.innerText());
    await expect(page.getByText(cast.pat.email).first(), "Pat should be shown as the author").toBeVisible();
    await expect(page.getByTestId("draft-party"), "Pat should see no 'deposited by' line").toHaveCount(0);
    await expect(page.getByText(DANA_KEY_LABEL), "Pat should not see the key label 'Dana laptop agent'").toHaveCount(0);
    await shot(page, testInfo, "E7-01-pat-after-confirm");
  });

  await test.step("Sam opens the detail page", async () => {
    const p = await newActorPage(page, testInfo, cast.sam, `/app/traces/${obo.id}`);
    await waitDetail(p);
    note(testInfo, "Sam header text", (await p.locator("header").first().innerText()).replace(/\s+/g, " "));
    await expect(p.getByText(cast.pat.email).first(), "Sam should see Pat as the author").toBeVisible();
    await expect(p.getByTestId("draft-status"), "Sam should see no draft label").toHaveCount(0);
    await expect(p.getByTestId("draft-party"), "Sam should see no 'deposited by' or 'about' line").toHaveCount(0);
    await expect(p.getByText(cast.dana.email), "Sam should not see Dana's email on Pat's recipe").toHaveCount(0);
    await expect(p.getByText(DANA_KEY_LABEL), "Sam should not see the key label 'Dana laptop agent'").toHaveCount(0);
    // Recorded, not asserted: whose key the agent badge's short id belongs to.
    const keysRes = await request.get(`${BACKEND_URL}/keys`, { headers: asUser(cast.dana) });
    const danaKeys = (((await json(keysRes))["data"] ?? []) as Array<{ id: string; label: string | null }>);
    const danaKeyId = danaKeys.find((k) => k.label === DANA_KEY_LABEL)?.id ?? "(not found)";
    const shownPrefix = danaKeyId.slice(0, 8);
    note(testInfo, "Dana's key id prefix / shown to Sam", `${shownPrefix} / ${(await p.getByText(`${shownPrefix}…`).count()) > 0 ? "shown" : "not shown"}`);
    await shot(p, testInfo, "E7-02-sam-verified-detail");
    await p.context().close();
  });

  await test.step("Dana opens the detail page", async () => {
    const p = await newActorPage(page, testInfo, cast.dana, `/app/traces/${obo.id}`);
    await waitDetail(p);
    note(testInfo, "Dana header text", (await p.locator("header").first().innerText()).replace(/\s+/g, " "));
    const buttons = await p.getByRole("main").getByRole("button").allInnerTexts();
    note(testInfo, "Dana's controls", buttons.map((b) => b.trim()).join(" | "));
    await expect(p.getByTestId("draft-status"), "Dana should see no draft label").toHaveCount(0);
    await expect(p.getByTestId("draft-party"), "Dana should see no 'about' line").toHaveCount(0);
    await expect(p.getByText(DANA_KEY_LABEL), "Dana should not see her key label 'Dana laptop agent'").toHaveCount(0);
    await expect(p.getByRole("button", { name: /Delete/ }), "Dana, only a member now, should have no delete control").toHaveCount(0);
    await shot(p, testInfo, "E7-03-dana-verified-detail");
    await p.context().close();
  });
});

test("E8: accessibility scan on the slice 4 pages", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const obo = await onBehalf(request, cast, recipeText("e8", true), { impact: "high", uncertainty: "low" });
  const verified = await onBehalf(request, cast, recipeText("e8-verified"));
  const failures: string[] = [];
  const scan = async (p: Page, name: string) => {
    // Known pre-existing findings become "known-issue" annotations
    // (drafts-known-issues.ts); anything else still fails E8.
    const found = await axeBeyondKnown(p, testInfo, name);
    const serious = found.blocking;
    note(testInfo, `${name} serious/critical beyond the known list`, serious.length ? serious.join("; ") : "none");
    note(testInfo, `${name} known nodes`, String(found.knownNodes));
    note(testInfo, `${name} moderate`, found.moderate.length ? found.moderate.join("; ") : "none");
    if (serious.length) failures.push(`${name}: ${serious.join("; ")}`);
  };

  await test.step("Pat's queue with an on-behalf item", async () => {
    await signIn(page, cast.pat, "/app/drafts");
    await waitQueue(page);
    await expect(queueItem(page, obo.text), "the on-behalf item should be listed").toHaveCount(1);
    await scan(page, "E8-axe-pat-queue");
  });
  await test.step("Pat's detail page for the unresolved draft", async () => {
    await page.goto(`/app/traces/${obo.id}`);
    await waitDetail(page);
    await expect(page.getByTestId("draft-party"), "the deposited-by line should render").toBeVisible();
    await scan(page, "E8-axe-pat-detail");
  });
  const dana = await newActorPage(page, testInfo, cast.dana, `/app/traces/${obo.id}`);
  await test.step("Dana's detail page for the unresolved draft", async () => {
    await waitDetail(dana);
    await expect(dana.getByTestId("draft-party"), "the about line should render").toBeVisible();
    await scan(dana, "E8-axe-dana-detail");
  });
  await test.step("Dana's id-list view", async () => {
    await dana.goto(`/app/drafts?ids=${obo.id}`);
    await waitQueue(dana);
    await expect(queueItem(dana, obo.text), "Dana's link view should list the draft").toHaveCount(1);
    await scan(dana, "E8-axe-dana-link");
  });
  await dana.context().close();
  await test.step("Sam's view of a verified on-behalf recipe", async () => {
    await page.goto("/app/drafts");
    await confirmFromQueue(page, verified.text);
    const sam = await newActorPage(page, testInfo, cast.sam, `/app/traces/${verified.id}`);
    await waitDetail(sam);
    await expect(sam.getByTestId("draft-party"), "Sam should see no on-behalf line").toHaveCount(0);
    await scan(sam, "E8-axe-sam-verified");
    await sam.context().close();
  });
  expect(failures, "axe should find zero serious or critical violations beyond the known list on each of the five pages").toEqual([]);
});

test("E9: keyboard only reaches Dana's delete control", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const obo = await onBehalf(request, cast, recipeText("e9"));

  await test.step("Dana tabs from the page top to the delete control", async () => {
    await signIn(page, cast.dana, `/app/traces/${obo.id}`);
    await waitDetail(page);
    await page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => undefined);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let reached = false;
    let presses = 0;
    for (; presses < 80; presses++) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? (el.getAttribute("aria-label") ?? el.innerText ?? "") : "";
      });
      if (/^Delete/.test(label)) { reached = true; break; }
    }
    note(testInfo, "Tab presses to reach delete", String(presses + 1));
    expect(reached, "the delete control should be reachable with Tab alone").toBe(true);
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      return { name: el.getAttribute("aria-label") ?? el.innerText, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, boxShadow: s.boxShadow, focusVisible: el.matches(":focus-visible") };
    });
    note(testInfo, "focused element", JSON.stringify(focus));
    expect(focus.name, "the focused delete control's accessible name should say it deletes the draft about Pat").toContain(`Delete draft about ${cast.pat.email}`);
    const hasIndicator = (!focus.outline.startsWith("none") && !/ 0px /.test(focus.outline)) || focus.boxShadow !== "none";
    expect(hasIndicator, "the focused delete control should show a visible focus indicator (outline or ring)").toBe(true);
    await shot(page, testInfo, "E9-01-dana-delete-focused", false);
  });
});

test("E10: phone width, no horizontal scroll and long emails wrap @mobile", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request, true);
  note(testInfo, "Pat email", cast.pat.email);
  note(testInfo, "Dana email", cast.dana.email);
  const obo = await onBehalf(request, cast, recipeText("e10", true), { impact: "high", uncertainty: "low" });
  const verified = await onBehalf(request, cast, recipeText("e10-verified", true));
  // Control: the same long emails on a recipe without the long unbroken token,
  // to tell an overflow caused by the emails from one caused by the recipe text.
  const plain = await onBehalf(request, cast, recipeText("e10-control"));
  const problems: string[] = [];

  // headingKnown: a detail page whose recipe heading holds the long unbroken
  // token. Its overflow is the known heading issue (drafts-known-issues.ts)
  // only if giving the heading overflow-wrap makes the page fit and the email
  // line wrap; any other cause still fails. Every other page is asserted as is.
  const measure = async (p: Page, name: string, emailLocator: ReturnType<Page["getByText"]> | null, headingKnown = false) => {
    await p.waitForLoadState("networkidle");
    // Measured against the device width with the shared helper: on the mobile
    // project Chrome widens the layout viewport, so innerWidth hides overflow.
    const o = await horizontalOverflow(p);
    const limit = o.deviceWidth;
    note(testInfo, `${name} contentWidth/device`, `${o.contentWidth}/${o.deviceWidth}`);
    if (o.contentWidth > limit) {
      const wide = await p.evaluate((lim) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const r = el.getBoundingClientRect();
          const kidsPast = Array.from(el.children).some((c) => c.getBoundingClientRect().right > lim + 1);
          if (r.right > lim + 1 && !kidsPast) out.push(`${el.tagName.toLowerCase()} right=${Math.round(r.right)} "${(el.textContent ?? "").slice(0, 50)}"`);
        }
        return out.slice(0, 6);
      }, limit);
      note(testInfo, `${name} elements past the viewport`, wide.join(" ; "));
    }
    const emailRight = async () => {
      const box = emailLocator ? await emailLocator.boundingBox() : null;
      return box ? box.x + box.width : null;
    };
    const right = await emailRight();
    note(testInfo, `${name} email line right edge`, String(right));
    await shot(p, testInfo, name);
    const fits = (width: number, r: number | null) => width <= limit && (r === null || r <= limit + 0.5);
    if (fits(o.contentWidth, right)) return;
    if (headingKnown) {
      await p.addStyleTag({ content: "h1 { overflow-wrap: anywhere; }" });
      const o2 = await horizontalOverflow(p);
      const r2 = await emailRight();
      note(testInfo, `${name} with overflow-wrap on the heading (diagnostic)`, `content ${o2.contentWidth}/${limit}, email line right edge ${r2}`);
      if (fits(o2.contentWidth, r2)) {
        knownIssue(testInfo, KNOWN_HEADING_OVERFLOW);
        return;
      }
    }
    problems.push(`${name}: content width ${o.contentWidth} > device ${limit}, or the email line runs past it (right edge ${right === null ? "n/a" : Math.round(right)})`);
  };

  await test.step("Pat's queue", async () => {
    await signIn(page, cast.pat, "/app/drafts");
    await waitQueue(page);
    const item = queueItem(page, obo.text);
    await expect(item, "the on-behalf item should be listed").toHaveCount(1);
    await measure(page, "E10-01-mobile-pat-queue", item.getByTestId("queue-party"));
  });
  await test.step("Pat's detail page", async () => {
    await page.goto(`/app/traces/${obo.id}`);
    await waitDetail(page);
    await measure(page, "E10-02-mobile-pat-detail", page.getByTestId("draft-party"), true);
  });
  await test.step("control: Pat's detail page for a recipe without the long token", async () => {
    await page.goto(`/app/traces/${plain.id}`);
    await waitDetail(page);
    await measure(page, "E10-control-pat-detail-short-recipe", page.getByTestId("draft-party"));
  });
  const dana = await newActorPage(page, testInfo, cast.dana, `/app/traces/${obo.id}`);
  await test.step("Dana's detail page", async () => {
    await waitDetail(dana);
    await measure(dana, "E10-03-mobile-dana-detail", dana.getByTestId("draft-party"), true);
  });
  await test.step("Dana's id-list view", async () => {
    await dana.goto(`/app/drafts?ids=${obo.id}`);
    await waitQueue(dana);
    const item = queueItem(dana, obo.text);
    await expect(item, "Dana's link view should list the draft").toHaveCount(1);
    await measure(dana, "E10-04-mobile-dana-link", item.locator("[id^=blocked-]"));
  });
  await dana.context().close();
  await test.step("Sam's verified detail page", async () => {
    await page.goto("/app/drafts");
    await confirmFromQueue(page, verified.text);
    const sam = await newActorPage(page, testInfo, cast.sam, `/app/traces/${verified.id}`);
    await waitDetail(sam);
    await measure(sam, "E10-05-mobile-sam-verified", null, true);
    await sam.context().close();
  });
  expect(problems, "at phone width no page should scroll sideways (beyond the known heading issue) and the long emails should wrap inside the viewport").toEqual([]);
});

test("E11: reload after delete and after confirm shows the same state", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const toDelete = await onBehalf(request, cast, recipeText("e11-delete"));
  const toConfirm = await onBehalf(request, cast, recipeText("e11-confirm"));

  await test.step("Dana deletes one draft, then reloads where she landed and Pat's queue", async () => {
    await signIn(page, cast.dana, `/app/traces/${toDelete.id}`);
    await waitDetail(page);
    await page.getByRole("button", { name: /Delete/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").last().fill("DELETE");
    await dialog.getByRole("button", { name: /^Delete$/ }).click();
    await expect(dialog, "the dialog should close once the delete succeeds").toHaveCount(0);
    await page.goto(`/app/traces/${toDelete.id}`);
    await page.reload();
    await expect(page.getByText("Trace not found."), "after a reload, the deleted draft's page should stay gone for Dana").toBeVisible();
    const pat = await newActorPage(page, testInfo, cast.pat, "/app/drafts");
    await waitQueue(pat);
    await pat.reload();
    await waitQueue(pat);
    await expect(queueItem(pat, toDelete.text), "after a reload, Pat's queue should still not list the deleted draft").toHaveCount(0);
    await shot(pat, testInfo, "E11-01-after-delete-reload");

    await test.step("Pat confirms the other draft and reloads its detail page", async () => {
      await confirmFromQueue(pat, toConfirm.text);
      await pat.reload();
      await waitQueue(pat);
      await expect(queueItem(pat, toConfirm.text), "after a reload, the confirmed draft should stay out of Pat's queue").toHaveCount(0);
      await pat.goto(`/app/traces/${toConfirm.id}`);
      await waitDetail(pat);
      await pat.reload();
      await waitDetail(pat);
      await expect(pat.getByTestId("draft-status"), "after a reload, the detail page should still show it as verified").toContainText("Verified");
      await shot(pat, testInfo, "E11-02-after-confirm-reload");
    });
    await pat.context().close();
  });
});

test("O1: what Dana sees on a draft about Pat that Pat rejected", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const obo = await onBehalf(request, cast, recipeText("o1"));

  await test.step("Pat rejects the draft from his queue", async () => {
    const pat = await newActorPage(page, testInfo, cast.pat, "/app/drafts");
    await waitQueue(pat);
    await queueItem(pat, obo.text).getByRole("button", { name: /^Reject/ }).click();
    await expect(pat.getByRole("status"), "the queue should announce the rejection").toContainText("Rejected");
    await pat.context().close();
  });

  await test.step("Dana opens its detail page (recorded, not judged)", async () => {
    await signIn(page, cast.dana, `/app/traces/${obo.id}`);
    await page.waitForLoadState("networkidle");
    const header = page.locator("main");
    note(testInfo, "Dana's rejected-draft page text", (await header.innerText()).replace(/\s+/g, " ").slice(0, 800));
    const buttons = await page.getByRole("main").getByRole("button").allInnerTexts();
    note(testInfo, "Dana's controls", buttons.map((b) => b.trim()).join(" | "));
    await shot(page, testInfo, "O1-01-dana-rejected-detail");
    const status = page.getByTestId("draft-status");
    if (await status.count()) note(testInfo, "status label title (tooltip)", String(await status.getAttribute("title")));
  });

  await test.step("Dana tries the delete control offered on the rejected draft (recorded)", async () => {
    const del = page.getByRole("button", { name: /Delete/ });
    if ((await del.count()) === 0) { note(testInfo, "delete on rejected draft", "no delete control offered"); return; }
    await del.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").last().fill("DELETE");
    await dialog.getByRole("button", { name: /^Delete$/ }).click();
    await page.waitForTimeout(1500);
    const stillOpen = await dialog.count();
    note(testInfo, "delete on rejected draft", stillOpen ? `dialog still open, text: ${(await dialog.innerText()).replace(/\s+/g, " ").slice(-200)}` : `dialog closed; landed on ${page.url()}`);
  });
});

test("O2: where Dana lands after deleting", async ({ page, request }, testInfo) => {
  const cast = await setupCast(request);
  const obo = await onBehalf(request, cast, recipeText("o2"));

  await test.step("Dana deletes and the landing URL is recorded", async () => {
    await signIn(page, cast.dana, `/app/traces/${obo.id}`);
    await waitDetail(page);
    await page.getByRole("button", { name: /Delete/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").last().fill("DELETE");
    await dialog.getByRole("button", { name: /^Delete$/ }).click();
    await expect(dialog, "the dialog should close once the delete succeeds").toHaveCount(0);
    await page.waitForLoadState("networkidle");
    note(testInfo, "Dana landed on", page.url());
    note(testInfo, "landing heading", (await page.getByRole("heading", { level: 1 }).first().innerText().catch(() => "(none)")));
  });
});
