import { test, expect, type Page } from "@playwright/test";
import { seedUser, asUser, signIn, type SeededUser } from "./helpers/accounts";
import { shot, axeFindings, horizontalOverflow } from "./helpers/evidence";
import { BACKEND_URL } from "../../playwright.config";
import { axeBeyondKnown } from "./drafts-known-issues";

// Slice 5 (headless keys) browser run, verifier a-drafts-verify-s5-2026-09-28.
// Expectations: claimNet docs/working/browser-verification/2026-09-28-drafts-slice5/expectations.md.
// Regression test on main since the 2026-09-29 post-merge run (claimNet
// docs/working/browser-verification/2026-09-29-drafts-post-merge/results-regression.md).

async function withSecondBook(request: import("@playwright/test").APIRequestContext, user: SeededUser): Promise<void> {
  const books = (await (await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(user) })).json()).data as Array<{ organization_id: string }>;
  const r = await request.post(`${BACKEND_URL}/recipe-books`, { headers: asUser(user), data: { name: "Second book", slug: `second-${Date.now()}`, organizationId: books[0]!.organization_id } });
  expect(r.ok(), "a second book should be created for the scope picker").toBe(true);
}

async function openForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Create Key/ }).click();
  await expect(page.getByRole("heading", { name: "New API Key" }), "the new-key form should open").toBeVisible();
}

async function keysList(request: import("@playwright/test").APIRequestContext, user: SeededUser): Promise<Array<{ label: string | null; depositLevel: string }>> {
  return (await (await request.get(`${BACKEND_URL}/keys`, { headers: asUser(user) })).json()).data;
}

async function createKey(page: Page, label: string, headless: boolean): Promise<void> {
  await openForm(page);
  const box = page.getByRole("checkbox", { name: "Headless" });
  await expect(box, "the Headless checkbox should be unticked when the form opens").not.toBeChecked();
  await page.getByLabel("Label (optional)").fill(label);
  if (headless) await box.check();
  await page.getByRole("button", { name: "Generate Key" }).click();
  await expect(page.getByText("Key shown once only — copy it now"), "the just-created banner should appear").toBeVisible();
}

test("E1 + E2 + E7a: the form's Headless checkbox, its description, keyboard focus, axe", async ({ page, request }, testInfo) => {
  const pat = await seedUser(request, "s5-pat");
  await withSecondBook(request, pat);
  await signIn(page, pat, "/app/keys");
  await test.step("open the scoped form", async () => {
    await openForm(page);
    const box = page.getByRole("checkbox", { name: "Headless" });
    await expect(box, "a checkbox named Headless should be visible").toBeVisible();
    await expect(box, "Headless should be off by default").not.toBeChecked();
    await expect(box, "the description should be associated through aria-describedby").toHaveAccessibleDescription(/draft.*review.*cannot verify drafts.*unattended/i);
    await expect(page.locator("#scopedHeadlessDescription"), "the description should be visible text").toBeVisible();
    testInfo.annotations.push({ type: "description", description: (await page.locator("#scopedHeadlessDescription").innerText()) });
    await shot(page, testInfo, "E1-01-scoped-form-open");
  });
  await test.step("E2 keyboard", async () => {
    await page.getByLabel("Label (optional)").focus();
    const box = page.getByRole("checkbox", { name: "Headless" });
    let reached = false;
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      if (await box.evaluate((el) => el === document.activeElement)) { reached = true; break; }
    }
    expect(reached, "Tab from the label field should reach the Headless checkbox").toBe(true);
    await page.waitForTimeout(500);
    await box.locator("..").screenshot({ path: testInfo.outputPath("E2-02-checkbox-closeup.png") });
    await testInfo.attach("E2-02-checkbox-closeup", { path: testInfo.outputPath("E2-02-checkbox-closeup.png"), contentType: "image/png" });
    const ring = await box.evaluate((el) => { const s = getComputedStyle(el); return { outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, shadow: s.boxShadow }; });
    testInfo.annotations.push({ type: "focus-style", description: JSON.stringify(ring) });
    const visible = (!/^none /.test(ring.outline) && !/ 0px /.test(ring.outline)) || (ring.shadow !== "none" && !/rgba\(0, 0, 0, 0\)/.test(ring.shadow) && /[1-9]px/.test(ring.shadow));
    await shot(page, testInfo, "E2-01-checkbox-focused");
    expect(visible, `the focused checkbox should draw a visible focus ring (${JSON.stringify(ring)})`).toBeTruthy();
    await page.keyboard.press("Space");
    await expect(box, "Space should tick the checkbox").toBeChecked();
  });
  await test.step("E7a axe with the form open", async () => {
    const f = await axeFindings(page, testInfo, "E7-a-form-open");
    testInfo.annotations.push({ type: "axe-a", description: JSON.stringify(f) });
    expect(f.blocking, "no serious or critical axe violations with the form open").toEqual([]);
  });
});

test("E3 + E4 + E5 + E6 + E7b-d: creating keys, labels, no toggle, copy briefing, axe", async ({ page, request, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const pat = await seedUser(request, "s5-pat");
  await withSecondBook(request, pat);
  await signIn(page, pat, "/app/keys");

  await test.step("E3 create a headless key", async () => {
    await createKey(page, "E3 headless", true);
    const banner = page.getByText("Key shown once only — copy it now").locator("..");
    await expect(banner.getByText("Headless: deposits drafts only"), "the just-created banner should say Headless: deposits drafts only").toBeVisible();
    await shot(page, testInfo, "E3-01-headless-banner");
    const keys = await keysList(request, pat);
    expect(keys.find((k) => k.label === "E3 headless")?.depositLevel, "GET /keys should list the key as drafts").toBe("drafts");
  });

  await test.step("E7b axe with the headless banner", async () => {
    const f = await axeBeyondKnown(page, testInfo, "E7-b-headless-banner"); // known findings become annotations (drafts-known-issues.ts)
    testInfo.annotations.push({ type: "axe-b", description: JSON.stringify(f) });
    expect.soft(f.blocking, "no serious or critical axe violations beyond the known list with the headless banner").toEqual([]);
  });

  await test.step("E6 copy briefing on the headless key", async () => {
    const resp = page.waitForResponse((r) => r.url().endsWith("/keys/briefing"));
    await page.getByRole("button", { name: "Copy agent briefing" }).click();
    const body = await (await resp).json();
    const text: string = body.data?.text ?? "";
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    testInfo.annotations.push({ type: "briefing-headless", description: `server has section: ${text.includes("## This key is headless")}; clipboard has section: ${clip.includes("## This key is headless")}` });
    await shot(page, testInfo, "E6-01-copy-briefing-headless");
    expect(text, "the headless key's briefing should carry the headless section").toContain("## This key is headless");
    expect.soft(clip, "the clipboard should hold the headless briefing").toContain("## This key is headless");
  });

  await test.step("E3 reload keeps the row label", async () => {
    await page.reload();
    const row = page.locator("div").filter({ hasText: /E3 headless/ }).filter({ has: page.locator(".text-mono") }).last();
    await expect(page.getByText("Headless: deposits drafts only").first(), "after reload the headless row should still say so in text").toBeVisible();
    await expect(row.getByText("Headless: deposits drafts only"), "the label should sit in the E3 headless row").toBeVisible();
    await shot(page, testInfo, "E3-02-headless-row-after-reload");
    const f = await axeBeyondKnown(page, testInfo, "E7-c-headless-listed"); // known findings become annotations (drafts-known-issues.ts)
    testInfo.annotations.push({ type: "axe-c", description: JSON.stringify(f) });
    expect.soft(f.blocking, "no serious or critical axe violations beyond the known list with a headless key listed").toEqual([]);
  });

  await test.step("E4 control: an ordinary key", async () => {
    await createKey(page, "E4 ordinary", false);
    const resp = page.waitForResponse((r) => r.url().endsWith("/keys/briefing"));
    await page.getByRole("button", { name: "Copy agent briefing" }).click();
    const text: string = (await (await resp).json()).data?.text ?? "";
    expect(text, "the ordinary key's briefing should have no headless section").not.toContain("This key is headless");
    await page.reload();
    const keys = await keysList(request, pat);
    expect(keys.find((k) => k.label === "E4 ordinary")?.depositLevel, "GET /keys should list the ordinary key as full").toBe("full");
    await expect(page.getByText("Headless: deposits drafts only"), "only one row (the headless key) should carry the label").toHaveCount(1);
    await shot(page, testInfo, "E4-01-ordinary-row");
  });

  await test.step("E5 expanded rows have no toggle", async () => {
    await page.getByText(/E3 headless/).first().click();
    const note = page.getByText(/Headless is chosen when a key is made/);
    await expect(note, "the headless row should say to make a new key to change it").toBeVisible();
    await expect(page.getByRole("checkbox"), "no checkbox should appear outside the new-key form").toHaveCount(0);
    await expect(page.getByRole("switch"), "no switch should appear").toHaveCount(0);
    await expect(page.getByRole("button", { name: /headless/i }), "no button should change headless").toHaveCount(0);
    await shot(page, testInfo, "E5-01-headless-row-expanded");
    const f = await axeBeyondKnown(page, testInfo, "E7-d-headless-expanded"); // known findings become annotations (drafts-known-issues.ts)
    testInfo.annotations.push({ type: "axe-d", description: JSON.stringify(f) });
    expect.soft(f.blocking, "no serious or critical axe violations beyond the known list with the headless row expanded").toEqual([]);
    await page.getByText(/E3 headless/).first().click();
    await page.getByText(/E4 ordinary/).first().click();
    testInfo.annotations.push({ type: "E5-open-ordinary-row-note", description: String(await page.getByText(/Headless is chosen when a key is made/).count()) });
  });

  await test.step("Extra: daily-key section mentions headless?", async () => {
    const daily = page.locator("section").first();
    testInfo.annotations.push({ type: "daily-headless-mentions", description: String(await daily.getByText(/headless/i).count()) });
  });
});

test("E8: phone width with the form open and a headless key listed @mobile-only", async ({ page, request }, testInfo) => {
  const pat = await seedUser(request, "s5-pat");
  const books = (await (await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(pat) })).json()).data as Array<{ id: string }>;
  const mint = await request.post(`${BACKEND_URL}/keys/scoped`, { headers: asUser(pat), data: { readRecipeBookIds: [books[0]!.id], writeRecipeBookIds: [books[0]!.id], defaultWriteRecipeBookId: books[0]!.id, expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(), label: "E8 headless phone key", depositLevel: "drafts" } });
  expect(mint.ok(), "fixture: a headless key should be minted").toBe(true);
  await signIn(page, pat, "/app/keys");
  await expect(page.getByText("Headless: deposits drafts only"), "the headless key should be listed").toBeVisible();
  await test.step("form open", async () => {
    await openForm(page);
    const o = await horizontalOverflow(page);
    testInfo.annotations.push({ type: "overflow-form", description: JSON.stringify(o) });
    await shot(page, testInfo, "E8-01-mobile-form-open");
    expect(o.overflowPx, `the page should fit ${o.deviceWidth}px with the form open (content ${o.contentWidth}px)`).toBeLessThanOrEqual(0);
  });
  await test.step("headless row expanded", async () => {
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByText(/E8 headless phone key/).first().click();
    const o = await horizontalOverflow(page);
    testInfo.annotations.push({ type: "overflow-row", description: JSON.stringify(o) });
    await shot(page, testInfo, "E8-02-mobile-headless-listed");
    expect(o.overflowPx, `the page should fit ${o.deviceWidth}px with the headless row expanded (content ${o.contentWidth}px)`).toBeLessThanOrEqual(0);
  });
});
