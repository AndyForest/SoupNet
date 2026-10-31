import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page, type TestInfo } from "@playwright/test";
import postgres from "postgres";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, signInNewContext, type SeededUser } from "./helpers/accounts";
import { assertNoHorizontalScroll, axeFindings, horizontalOverflow, shot } from "./helpers/evidence";

// The organization console: the org admin's pages, the member's own page, the
// site operator's Organizations pages and the sharing policy's refusals in the
// SPA (organization accounts round 1, stream Console; PR #156).
// Every actor is seeded per test; the site operator ("Sys") is the one account
// promoted by a direct database write, because no route grants the system role.
// Kept as a regression test after the 2026-10-26 runs. Against a worktree stack
// with its own database, set E2E_PGDATABASE to that database's name.

const RUN = Date.now().toString(36);
let seq = 0;
const tag = (label: string) => `${label}-${RUN}${++seq}`.toLowerCase();

function note(testInfo: TestInfo, type: string, description: string) {
  testInfo.annotations.push({ type, description });
}

async function relogin(request: APIRequestContext, u: SeededUser): Promise<SeededUser> {
  const r = await request.post(`${BACKEND_URL}/auth/login`, { data: { email: u.email, password: u.password } });
  const body = await r.json();
  expect(r.ok(), `fixture: signing in again as ${u.email} should succeed; got ${r.status()} ${JSON.stringify(body)}`).toBe(true);
  return { ...u, token: body.data.token as string };
}

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

/** Seed an account and promote it to the site operator (the one SQL write in this spec). */
async function seedSys(request: APIRequestContext): Promise<SeededUser> {
  const u = await seedUser(request, "org-console-sys");
  const sql = postgres({ ...dbSettings(), max: 1, onnotice: () => {} });
  try {
    const rows = await sql`UPDATE claimnet.users SET role = 'system' WHERE email = ${u.email} RETURNING id`;
    expect(rows.length, `fixture: promoting ${u.email} should update exactly one row`).toBe(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
  return relogin(request, u);
}

async function api(request: APIRequestContext, method: "get" | "post" | "patch" | "put", path: string, who: SeededUser, data?: unknown) {
  const r = await request[method](`${BACKEND_URL}${path}`, { headers: asUser(who), ...(data === undefined ? {} : { data }) });
  const body = await r.json().catch(() => null);
  return { status: r.status(), ok: r.ok(), body };
}

async function fixture(request: APIRequestContext, what: string, method: "get" | "post" | "patch" | "put", path: string, who: SeededUser, data?: unknown) {
  const r = await api(request, method, path, who, data);
  expect(r.ok, `fixture: ${what} should succeed; got ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`).toBe(true);
  return r.body;
}

interface Acme {
  sys: SeededUser;
  olive: SeededUser;
  ada: SeededUser;
  max: SeededUser;
  gus: SeededUser;
  orgId: string;
  orgName: string;
  defaultBookId: string;
}

/** Sys creates Acme with Olive as owner, adds Ada (admin) and Max (member); Gus stays personal. */
async function setupAcme(request: APIRequestContext, label: string): Promise<Acme> {
  const sys = await seedSys(request);
  let olive = await seedUser(request, `org-console-${label}-olive`);
  let ada = await seedUser(request, `org-console-${label}-ada`);
  let max = await seedUser(request, `org-console-${label}-max`);
  const gus = await seedUser(request, `org-console-${label}-gus`);
  const slug = tag(`acme-${label}`);
  const orgName = `Acme ${slug}`;
  const created = await fixture(request, "Sys creating Acme", "post", "/admin/organizations", sys, { name: orgName, slug, ownerEmail: olive.email });
  const orgId = created.data.organizationId as string;
  const defaultBookId = created.data.defaultRecipeBookId as string;
  await fixture(request, "Sys adding Ada as admin", "post", `/admin/organizations/${orgId}/members`, sys, { email: ada.email, role: "admin" });
  await fixture(request, "Sys adding Max as member", "post", `/admin/organizations/${orgId}/members`, sys, { email: max.email, role: "member" });
  // Fresh sessions after the joins, so nothing here depends on whether a
  // join cuts earlier sessions (not under test).
  olive = await relogin(request, olive);
  ada = await relogin(request, ada);
  max = await relogin(request, max);
  return { sys, olive, ada, max, gus, orgId, orgName, defaultBookId };
}

async function createBook(request: APIRequestContext, who: SeededUser, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const b = await fixture(request, `${who.email} creating book ${name}`, "post", "/recipe-books", who, { name, slug, ...extra });
  return b.data.id as string;
}

async function memberIdOf(request: APIRequestContext, acme: Acme, email: string): Promise<string> {
  const b = await fixture(request, "Olive listing members", "get", `/organizations/${acme.orgId}/members?limit=50`, acme.olive);
  const row = (b.data.users as Array<{ id: string; email: string }>).find((u) => u.email === email);
  expect(row, `fixture: ${email} should be in Acme's member list`).toBeTruthy();
  return row!.id;
}

async function depositRecipe(request: APIRequestContext, who: SeededUser, bookId: string, label: string) {
  const k = await fixture(request, "minting a scoped key", "post", "/keys/scoped", who, {
    readRecipeBookIds: [bookId],
    writeRecipeBookIds: [bookId],
    defaultWriteRecipeBookId: bookId,
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    label: `org-console ${label}`,
  });
  const key = k.data.key as string;
  const qs = new URLSearchParams({
    key,
    recipe: `As a backend maintainer working on the org console check (${label}), I prefer small reviewed changes so that nothing ships unseen.`,
    evidence: `> "small reviewed changes ${label}"\n-- org-console.spec.ts fixture`,
    format: "json",
  });
  const res = await request.get(`${BACKEND_URL}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
  const body = await res.json();
  expect(res.ok(), `fixture: the deposit should succeed; got ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toBe(true);
}

async function sidebarItems(page: Page): Promise<string[]> {
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav, "the signed-in shell should show the main sidebar").toBeVisible();
  return nav.locator("a, summary").evaluateAll((els) =>
    els.map((e) => `${(e.textContent ?? "").trim()}${e.tagName === "A" ? ` (${e.getAttribute("href")})` : " (group)"}`),
  );
}

/** Header texts of the first table, as written (CSS uppercases them), with sort arrows removed. */
async function tableHeaders(page: Page): Promise<string[]> {
  return page.locator("table thead th").evaluateAll((ths) => ths.map((t) => (t.textContent ?? "").replace(/[▲▼]/g, "").trim()));
}

/** How wide the first table is against the box it scrolls in (columns past the box are hidden until scrolled). */
async function tableFit(page: Page) {
  return page.locator("table").first().evaluate((t) => {
    const w = t.parentElement as HTMLElement;
    return { boxWidth: w.clientWidth, tableWidth: t.scrollWidth, hiddenPx: Math.max(0, t.scrollWidth - w.clientWidth) };
  });
}

/** Extra evidence: scroll the first table's box fully right, screenshot, scroll back. */
async function shotTableScrolledRight(page: Page, testInfo: TestInfo, name: string) {
  const fit = await tableFit(page);
  note(testInfo, `${name} table fit`, JSON.stringify(fit));
  await page.locator("table").first().evaluate((t) => { (t.parentElement as HTMLElement).scrollLeft = 1e6; });
  await shot(page, testInfo, name);
  await page.locator("table").first().evaluate((t) => { (t.parentElement as HTMLElement).scrollLeft = 0; });
}

async function tabTo(page: Page, matches: (page: Page) => Promise<boolean>, max = 80): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press("Tab");
    if (await matches(page)) return i;
  }
  return -1;
}

async function newActor(browser: Browser, testInfo: TestInfo, u: SeededUser, path: string) {
  return signInNewContext(browser, testInfo, u, path);
}

// ── E1 ────────────────────────────────────────────────────────────────────

test("E1 the site Users page keeps its columns, filters, search, sort and premium grant", async ({ page, request }, testInfo) => {
  const sys = await seedSys(request);
  const prefix = tag("org-console-e1t");
  const t1 = await seedUser(request, `${prefix}-a`);
  const t2 = await seedUser(request, `${prefix}-b`);
  const search = page.getByRole("textbox", { name: /email/i });
  const bodyRows = page.locator("table tbody tr");

  await test.step("Sys opens /admin/users", async () => {
    await signIn(page, sys, "/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" }), "the site Users page should render for the site operator").toBeVisible();
    await expect(bodyRows.first(), "the users table should list accounts").toBeVisible();
    const headers = await tableHeaders(page);
    note(testInfo, "E1 headers", headers.join(" | "));
    expect(headers, "the columns should be Email, Status, Role, Premium, Created, Last login, Keys, Recipes, Recipe books, in that order").toEqual(
      ["Email", "Status", "Role", "Premium", "Created", "Last login", "Keys", "Recipes", "Recipe books"],
    );
    const filters = await page.locator("main label").evaluateAll((ls) => ls.map((l) => (l.childNodes[0]?.textContent ?? "").trim()));
    note(testInfo, "E1 filters", filters.join(" | "));
    expect(filters, "the filters should be Email, Verified, Suspended, Premium and Has keys").toEqual(["Email", "Verified", "Suspended", "Premium", "Has keys"]);
    await shot(page, testInfo, "E1-01-users-page");
    await shotTableScrolledRight(page, testInfo, "E1-01b-users-table-scrolled-right");
  });

  await test.step("search by a seeded email narrows the list", async () => {
    await search.fill(prefix);
    await expect(bodyRows, "searching the shared prefix should leave exactly the two seeded accounts").toHaveCount(2);
    await search.fill(t1.email);
    await expect(bodyRows, "searching one seeded email should leave exactly that account").toHaveCount(1);
    await expect(bodyRows.first(), "the remaining row should be the searched account").toContainText(t1.email);
  });

  await test.step("sort by Email", async () => {
    await search.fill(prefix);
    await expect(bodyRows, "the prefix search should show both seeded accounts again").toHaveCount(2);
    const emailHeader = page.locator("table thead th").filter({ hasText: /^Email/ });
    await emailHeader.click();
    await expect(emailHeader, "clicking Email should sort by it (descending first, arrow shown)").toContainText("▼");
    await expect(bodyRows.first(), "sorted descending by email, the -b account should come first").toContainText(t2.email);
    await emailHeader.click();
    await expect(emailHeader, "a second click should sort ascending").toContainText("▲");
    await expect(bodyRows.first(), "sorted ascending by email, the -a account should come first").toContainText(t1.email);
  });

  await test.step("grant premium to a seeded user, then reload", async () => {
    await search.fill(t1.email);
    const row = bodyRows.filter({ hasText: t1.email });
    await expect(row, "the seeded account's row should be shown").toHaveCount(1);
    await row.getByRole("button", { name: "Grant" }).click();
    await expect(row.getByRole("button", { name: "Revoke" }), "after granting, the row should offer Revoke").toBeVisible();
    await page.reload();
    await search.fill(t1.email);
    const after = bodyRows.filter({ hasText: t1.email });
    await expect(after, "after the reload the seeded account should still be found").toHaveCount(1);
    await expect(after, "after the reload the user should still show Premium").toContainText("Premium");
    await expect(after.getByRole("button", { name: "Revoke" }), "after the reload the grant should have persisted (Revoke offered)").toBeVisible();
    await shot(page, testInfo, "E1-02-premium-granted");
  });
});

// ── E2 ────────────────────────────────────────────────────────────────────

test("E2 the site operator creates an organization and sets its seats", async ({ page, request }, testInfo) => {
  const sys = await seedSys(request);
  const olive = await seedUser(request, "org-console-e2-olive");
  const slug = tag("acme-e2");
  const name = `Acme ${slug}`;
  const row = page.locator("table tbody tr").filter({ hasText: name });

  await test.step("open /admin/organizations, fill in name, slug and Olive's email, create", async () => {
    await signIn(page, sys, "/admin/organizations");
    await expect(page.getByRole("heading", { name: "Organizations" }), "the Organizations page should render for the site operator").toBeVisible();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByRole("textbox", { name: "Slug", exact: true }).fill(slug);
    await page.getByRole("textbox", { name: /Owner's email/ }).fill(olive.email);
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(row, "a row for the new organization should appear").toHaveCount(1);
    await expect(row, "the row should name Olive as owner").toContainText(olive.email);
    const cells = await row.locator("td").allTextContents();
    const headers = await tableHeaders(page);
    note(testInfo, "E2 headers", headers.join(" | "));
    note(testInfo, "E2 row after create", cells.join(" | "));
    expect(cells[headers.indexOf("Members")]?.trim(), "the new organization should have 1 member").toBe("1");
    await shot(page, testInfo, "E2-01-created");
  });

  await test.step("set the seat limit to 5 and reload", async () => {
    const seat = page.getByRole("spinbutton", { name: `Seat limit for ${name}` });
    await seat.fill("5");
    await seat.press("Tab");
    const seatsIdx = (await tableHeaders(page)).indexOf("Seats used");
    expect(seatsIdx, "the table should have a Seats used column").toBeGreaterThanOrEqual(0);
    await expect(row.locator("td").nth(seatsIdx), "seats used should read 1 / 5 once the limit saves").toHaveText("1 / 5");
    await page.reload();
    await expect(row, "the organization should still be listed after the reload").toHaveCount(1);
    await expect(page.getByRole("spinbutton", { name: `Seat limit for ${name}` }), "after the reload the seat limit should read 5").toHaveValue("5");
    await expect(row.locator("td").nth(seatsIdx), "after the reload seats used should read 1 / 5").toHaveText("1 / 5");
    await shot(page, testInfo, "E2-02-seats-after-reload");
    await shotTableScrolledRight(page, testInfo, "E2-02b-seats-table-scrolled-right");
  });
});

// ── E3 ────────────────────────────────────────────────────────────────────

test("E3 the site operator sees an organization's members with every column", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e3");

  await test.step("from /admin/organizations, click Acme", async () => {
    await signIn(page, acme.sys, "/admin/organizations");
    await page.getByRole("link", { name: acme.orgName }).click();
    await expect(page.getByRole("heading", { name: "Organization members" }), "clicking the organization should open its members page").toBeVisible();
    const rows = page.locator("table tbody tr");
    await expect(rows, "the members table should have three rows (Olive, Ada, Max)").toHaveCount(3);
    for (const u of [acme.olive, acme.ada, acme.max]) await expect(page.locator("table"), `the members table should list ${u.email}`).toContainText(u.email);
    const headers = await tableHeaders(page);
    note(testInfo, "E3 headers", headers.join(" | "));
    for (const h of ["Role", "Joined via", "Suspension reason", "Premium"]) {
      expect(headers, `the members table should include the "${h}" column`).toContain(h);
    }
    note(testInfo, "E3 rows", (await rows.allTextContents()).join(" || "));
    await shot(page, testInfo, "E3-01-org-members");
    await shotTableScrolledRight(page, testInfo, "E3-01b-org-members-scrolled-right");
  });
});

// ── E4 ────────────────────────────────────────────────────────────────────

test("E4 only an organization's owners and admins get the Organization link", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "e4");
  const cast: Array<[string, SeededUser, boolean, string | null]> = [
    ["Olive", acme.olive, true, "E4-01-olive-nav"],
    ["Ada", acme.ada, true, null],
    ["Max", acme.max, false, "E4-02-max-nav"],
    ["Gus", acme.gus, false, "E4-03-gus-nav"],
  ];
  for (const [name, u, sees, shotName] of cast) {
    await test.step(`sign in as ${name} and look at the sidebar`, async () => {
      const { context, page } = await newActor(browser, testInfo, u, "/app/dashboard");
      const items = await sidebarItems(page);
      note(testInfo, `E4 ${name} sidebar`, items.join(" | "));
      const link = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Organization", exact: true });
      if (sees) {
        await expect(link, `${name} (an Acme ${name === "Olive" ? "owner" : "admin"}) should see an Organization link`).toBeVisible();
        await expect(link, "the Organization link should go to /org").toHaveAttribute("href", "/org");
      } else {
        await expect(link, `${name} should not see an Organization link`).toHaveCount(0);
      }
      if (shotName) await shot(page, testInfo, shotName);
      await context.close();
    });
  }
});

// ── E5 ────────────────────────────────────────────────────────────────────

test("E5 a member or an outsider can't open the console", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "e5");
  for (const [name, u, shotName] of [["Max", acme.max, "E5-01-max-denied"], ["Gus", acme.gus, "E5-02-gus-denied"]] as const) {
    await test.step(`${name} goes to /org directly`, async () => {
      const { context, page } = await newActor(browser, testInfo, u, "/org");
      await expect(page.getByText(/You don't have access to this page/), `${name} should see a "you don't have access" message`).toBeVisible();
      await expect(page.locator("table"), `${name} should see no member table`).toHaveCount(0);
      const text = await page.locator("body").innerText();
      expect(text.includes(acme.olive.email) || text.includes(acme.ada.email), `${name} should see no member data`).toBe(false);
      note(testInfo, `E5 ${name} message`, (await page.getByText(/You don't have access/).textContent()) ?? "");
      await shot(page, testInfo, shotName);
      await context.close();
    });
  }
  await test.step("Olive (control) goes to /org", async () => {
    const { context, page } = await newActor(browser, testInfo, acme.olive, "/org");
    await expect(page.getByRole("heading", { name: "Members" }), "Olive should see the Members page").toBeVisible();
    await expect(page.locator("table tbody tr").filter({ hasText: acme.max.email }), "Olive should see Max in the member list").toHaveCount(1);
    await shot(page, testInfo, "E5-03-olive-control");
    await context.close();
  });
});

// ── E6 ────────────────────────────────────────────────────────────────────

test("E6 the Members page shows aggregates and never a private book's name", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e6");
  const secret = `max-secret-plans-${RUN}`;
  await createBook(request, acme.max, secret);
  await depositRecipe(request, acme.max, acme.defaultBookId, "e6");

  await test.step("Olive opens /org", async () => {
    await signIn(page, acme.olive, "/org");
    await expect(page.getByRole("heading", { name: "Members" }), "the Members page should render").toBeVisible();
    const rows = page.locator("table tbody tr");
    await expect(rows, "there should be one row each for Olive, Ada and Max").toHaveCount(3);
    const headers = await tableHeaders(page);
    note(testInfo, "E6 headers", headers.join(" | "));
    for (const h of ["Email", "Role", "Status", "Joined via", "Last active", "Recipes", "Private books", "Org-wide books", "Live keys"]) {
      expect(headers, `the Members table should have a "${h}" column`).toContain(h);
    }
    const recipesIdx = headers.indexOf("Recipes");
    const maxRow = rows.filter({ hasText: acme.max.email });
    await expect(maxRow.locator("td").nth(recipesIdx), "Max's recipe count should be 1").toHaveText("1");
    note(testInfo, "E6 rows", (await rows.allTextContents()).join(" || "));
    const html = await page.content();
    expect(html.includes("max-secret-plans"), "the text max-secret-plans should appear nowhere on the page (DOM included)").toBe(false);
    await shot(page, testInfo, "E6-01-members");
    await shotTableScrolledRight(page, testInfo, "E6-01b-members-scrolled-right");
  });
});

// ── E7 ────────────────────────────────────────────────────────────────────

test("E7 an admin disables and re-enables a member from the Members page", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e7");
  const row = (email: string) => page.locator("table tbody tr").filter({ hasText: email });
  const statusIdx = async () => (await tableHeaders(page)).indexOf("Status");

  await test.step("Ada opens /org", async () => {
    await signIn(page, acme.ada, "/org");
    await expect(row(acme.max.email), "Max's row should be listed").toHaveCount(1);
  });

  await test.step("disable Max, then reload", async () => {
    await row(acme.max.email).getByRole("button", { name: "Disable" }).click();
    const i = await statusIdx();
    await expect(row(acme.max.email).locator("td").nth(i), "after the disable, Max's status should read 'Disabled by the organization'").toHaveText("Disabled by the organization");
    await page.reload();
    await expect(row(acme.max.email).locator("td").nth(i), "after the reload Max should still be 'Disabled by the organization'").toHaveText("Disabled by the organization");
    await shot(page, testInfo, "E7-01-disabled");
  });

  await test.step("re-enable Max, then reload", async () => {
    await row(acme.max.email).getByRole("button", { name: "Re-enable" }).click();
    const i = await statusIdx();
    await expect(row(acme.max.email).locator("td").nth(i), "after the re-enable Max should read 'Active'").toHaveText("Active");
    await page.reload();
    await expect(row(acme.max.email).locator("td").nth(i), "after the reload Max should still read 'Active'").toHaveText("Active");
    await shot(page, testInfo, "E7-02-reenabled");
  });

  await test.step("no action on self or on the owner, and no Owner role choice", async () => {
    await expect(row(acme.ada.email).getByRole("button", { name: "Disable" }), "Ada's own row should have no Disable button").toHaveCount(0);
    await expect(row(acme.olive.email).getByRole("button", { name: "Disable" }), "Olive's row (the owner) should have no Disable button for Ada").toHaveCount(0);
    const selects = page.locator("table select");
    const options = await selects.evaluateAll((ss) => ss.map((s) => `${s.getAttribute("aria-label")}: ${[...(s as HTMLSelectElement).options].map((o) => o.text).join("/")}`));
    note(testInfo, "E7 role choices offered to Ada", options.join(" | ") || "(no role selects)");
    for (const o of options) expect(o, "Ada's role choices should never include Owner").not.toMatch(/Owner/);
    await expect(row(acme.olive.email).locator("select"), "Ada should get no role choice on the owner's row").toHaveCount(0);
    await shot(page, testInfo, "E7-03-no-action-on-owner-or-self");
    await shotTableScrolledRight(page, testInfo, "E7-03b-actions-scrolled-right");
  });
});

// ── E8 ────────────────────────────────────────────────────────────────────

test("E8 the Books page lists org-wide books and counts private ones", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e8");
  const priv = `max-private-${RUN}`;
  await createBook(request, acme.max, priv);

  await test.step("Olive opens /org/books", async () => {
    await signIn(page, acme.olive, "/org/books");
    await expect(page.getByRole("heading", { name: "Recipe books" }), "the Books page should render").toBeVisible();
    const rows = page.locator("table tbody tr");
    const defaultRow = rows.filter({ hasText: "(default)" });
    await expect(defaultRow, "the default book should be listed, marked as the default").toHaveCount(1);
    await expect(defaultRow.locator("td").nth(1), "the default book should have 3 members").toHaveText("3");
    note(testInfo, "E8 rows", (await rows.allTextContents()).join(" || "));
    const privateCard = page.getByText("Private books", { exact: true }).locator("..");
    note(testInfo, "E8 private books card", (await privateCard.textContent()) ?? "");
    await expect(privateCard, "private books should show as a count (at least Max's one)").toContainText(/[1-9]/);
    expect((await page.content()).includes(priv), "the private book's name should appear nowhere").toBe(false);
    await shot(page, testInfo, "E8-01-books");
  });
});

// ── E9 ────────────────────────────────────────────────────────────────────

test("E9 setting the outbound sharing policy persists", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e9");
  const outbound = page.getByRole("combobox", { name: /Our recipe books/ });
  const inbound = page.getByRole("combobox", { name: /Other people's recipe books/ });

  await test.step("Olive opens /org/books", async () => {
    await signIn(page, acme.olive, "/org/books");
    await expect(outbound, "the outbound sharing choice should be shown").toBeVisible();
    await expect(outbound, "outbound should start as allowed").toHaveValue("allowed");
    await expect(inbound, "inbound should start as allowed").toHaveValue("allowed");
    await shot(page, testInfo, "E9-01-before");
  });

  await test.step("set outbound to nobody can share, save, reload", async () => {
    await outbound.selectOption({ label: "Nobody can share outside the organization" });
    const save = page.getByRole("button", { name: "Save sharing policy" });
    await expect(save, "Save should be enabled after a change").toBeEnabled();
    const saved = page.waitForResponse((r) => r.url().includes("/sharing") && r.request().method() === "PATCH");
    await save.click();
    expect((await saved).ok(), "saving the policy should succeed").toBe(true);
    await page.reload();
    await expect(outbound, "after the reload outbound should still be 'nobody can share'").toHaveValue("blocked");
    await expect(outbound.locator("option:checked"), "the outbound choice should read 'Nobody can share...'").toHaveText("Nobody can share outside the organization");
    await expect(inbound, "inbound should be unchanged (allowed)").toHaveValue("allowed");
    await shot(page, testInfo, "E9-02-after-reload");
  });
});

// ── E10 ───────────────────────────────────────────────────────────────────

async function openBookCard(page: Page, bookName: string) {
  const heading = page.getByRole("heading", { name: bookName, exact: true });
  await expect(heading, `the book ${bookName} should be listed on Recipe Books`).toBeVisible();
  await heading.click();
  const card = page.locator(".card").filter({ has: heading });
  await expect(card.getByRole("textbox", { name: "Invite by email" }), "expanding the book should show the invite box").toBeVisible();
  return card;
}

test("E10 an outbound block refuses an invitation in the SPA, with plain copy", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e10");
  const bookA = `max-book-a-${RUN}`;
  const bookB = `max-book-b-${RUN}`;
  await createBook(request, acme.max, bookA);
  await createBook(request, acme.max, bookB);

  await test.step("control: with sharing allowed, Max invites Gus to his own book", async () => {
    await signIn(page, acme.max, "/app/recipe-books");
    const card = await openBookCard(page, bookA);
    await card.getByRole("textbox", { name: "Invite by email" }).fill(acme.gus.email);
    await card.getByRole("button", { name: "Send invite" }).click();
    await expect(card.getByText(`Invited ${acme.gus.email}.`), "the control invitation should succeed").toBeVisible();
    await shot(page, testInfo, "E10-01-control-invited");
  });

  await test.step("with outbound blocked, Max invites Gus to another of his books", async () => {
    await fixture(request, "Olive blocking outbound", "patch", `/organizations/${acme.orgId}/sharing`, acme.olive, { outbound: "blocked" });
    await page.reload();
    const card = await openBookCard(page, bookB);
    await card.getByRole("textbox", { name: "Invite by email" }).fill(acme.gus.email);
    const resp = page.waitForResponse((r) => r.url().includes("/invite") && r.request().method() === "POST");
    await card.getByRole("button", { name: "Send invite" }).click();
    const r = await resp;
    const body = await r.json();
    note(testInfo, "E10 API response", `${r.status()} ${JSON.stringify(body)}`);
    expect(r.status(), "the blocked invitation should be refused with 403").toBe(403);
    await expect(card.getByText(`Invited ${acme.gus.email}.`), "the blocked invitation should not show as sent").toHaveCount(0);
    const err = card.locator("p[style*='--color-error']");
    await expect(err, "the blocked invitation should show an error under the invite box").toBeVisible();
    note(testInfo, "E10 exact text shown to Max", (await err.textContent()) ?? "(none)");
    await shot(page, testInfo, "E10-02-blocked-refusal");
    await expect.soft(err, "the refusal should not show a raw error code").not.toHaveText("sharing_blocked");
    // The proxy for "names the organization's policy": the copy names the
    // organization and its rule ("Your organization doesn't allow ...").
    await expect.soft(err, "the refusal should name the organization's policy (the organization and what it doesn't allow)").toContainText(/your organization (doesn't|does not) allow/i);
    await expect.soft(err, "the refusal should say to ask an admin").toContainText(/admin/i);
  });
});

// ── E11 ───────────────────────────────────────────────────────────────────

test("E11 an inbound block refuses the accept, and the invitation stays", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e11");
  const bookA = `gus-book-a-${RUN}`;
  const bookB = `gus-book-b-${RUN}`;
  const idA = await createBook(request, acme.gus, bookA);
  const idB = await createBook(request, acme.gus, bookB);
  const invite = (name: string) => page.locator(".card").filter({ hasText: `invited you to` }).filter({ hasText: name });

  await test.step("control: Gus invites Max to book A and Max accepts", async () => {
    await fixture(request, "Gus inviting Max to book A", "post", `/recipe-books/${idA}/invite`, acme.gus, { email: acme.max.email });
    await signIn(page, acme.max, "/app/recipe-books");
    await expect(invite(bookA), "Max should see Gus's invitation to book A").toBeVisible();
    await invite(bookA).getByRole("button", { name: "Accept" }).click();
    await expect(invite(bookA), "after accepting, the invitation should be gone").toHaveCount(0);
    await expect(page.getByRole("heading", { name: bookA, exact: true }), "book A should now be among Max's books").toBeVisible();
    await shot(page, testInfo, "E11-01-control-accepted");
  });

  await test.step("Olive blocks inbound, Gus invites Max to book B, Max tries to accept", async () => {
    await fixture(request, "Olive blocking inbound", "patch", `/organizations/${acme.orgId}/sharing`, acme.olive, { inbound: "blocked" });
    await fixture(request, "Gus inviting Max to book B", "post", `/recipe-books/${idB}/invite`, acme.gus, { email: acme.max.email });
    await page.goto("/app/recipe-books");
    await expect(invite(bookB), "Max should see Gus's invitation to book B").toBeVisible();
    const resp = page.waitForResponse((r) => r.url().includes("/accept") && r.request().method() === "POST");
    await invite(bookB).getByRole("button", { name: "Accept" }).click();
    const r = await resp;
    const body = await r.json();
    note(testInfo, "E11 API response", `${r.status()} ${JSON.stringify(body)}`);
    expect(r.status(), "the blocked accept should be refused with 403").toBe(403);
    await shot(page, testInfo, "E11-02-refused");
    const alert = invite(bookB).getByRole("alert");
    await expect.soft(alert, "the refused accept should show an error on the invitation").toBeVisible();
    note(testInfo, "E11 exact text shown to Max", (await alert.textContent().catch(() => null)) ?? "(none)");
    await expect.soft(alert, "the error should name Max's organization's policy (the organization and what it doesn't allow)").toContainText(/your organization (doesn't|does not) allow/i);
    await expect.soft(alert, "the error should not be a raw code").not.toHaveText("sharing_blocked");
  });

  await test.step("reload: the invitation is still pending", async () => {
    await page.reload();
    await expect(invite(bookB), "after the reload the invitation to book B should still be listed as pending").toBeVisible();
    await expect(page.getByRole("heading", { name: bookB, exact: true }), "book B should not be among Max's books").toHaveCount(0);
    await shot(page, testInfo, "E11-03-still-pending-after-reload");
  });
});

// ── E12 ───────────────────────────────────────────────────────────────────

test("E12 the Activity page shows admin actions, with Soup.net for the operator", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e12");
  const maxId = await memberIdOf(request, acme, acme.max.email);
  await fixture(request, "Ada disabling Max", "post", `/organizations/${acme.orgId}/members/${maxId}/disable`, acme.ada);

  await test.step("Olive opens /org/activity", async () => {
    await signIn(page, acme.olive, "/org/activity");
    await expect(page.getByRole("heading", { name: "Activity" }), "the Activity page should render").toBeVisible();
    const rows = page.locator("table tbody tr");
    await expect(rows.first(), "the activity table should list events").toBeVisible();
    const all = await rows.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()).join(" | ")));
    note(testInfo, "E12 event rows", all.join(" || "));
    const joined = rows.filter({ hasText: `${acme.max.email} joined` });
    await expect(joined, "the page should list Max joining").toHaveCount(1);
    await expect(joined.locator("td").nth(1), "Max's join should show Soup.net as who did it").toHaveText("Soup.net");
    const disabled = rows.filter({ hasText: `Disabled ${acme.max.email}` });
    await expect(disabled, "the page should list Max being disabled").toHaveCount(1);
    await expect(disabled.locator("td").nth(1), "Max's disable should show Ada's email as who did it").toHaveText(acme.ada.email);
    expect((await page.content()).includes(acme.sys.email), "Sys's email should appear nowhere on the page").toBe(false);
    await shot(page, testInfo, "E12-01-activity");
    await shotTableScrolledRight(page, testInfo, "E12-01b-activity-scrolled-right");
  });
});

// ── E13 ───────────────────────────────────────────────────────────────────

test("E13 the member's own organization page", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "e13");
  const maxId = await memberIdOf(request, acme, acme.max.email);
  await fixture(request, "Ada disabling Max", "post", `/organizations/${acme.orgId}/members/${maxId}/disable`, acme.ada);
  await fixture(request, "Ada re-enabling Max", "post", `/organizations/${acme.orgId}/members/${maxId}/enable`, acme.ada);
  const max = await relogin(request, acme.max); // a password sign-in after the re-enable

  await test.step("Max opens Settings and the Your organization tab", async () => {
    const { context, page } = await newActor(browser, testInfo, max, "/app/settings");
    const tab = page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your organization" });
    await expect(tab, "Max (managed) should see a 'Your organization' tab").toBeVisible();
    await tab.click();
    await expect(page.getByRole("heading", { name: "What your organization's admins can see" }), "the page should be titled \"What your organization's admins can see\"").toBeVisible();
    const content = page.locator("section").filter({ has: page.getByRole("heading", { name: "What your organization's admins can see" }) });
    const text = await content.innerText();
    note(testInfo, "E13 Max page text", text.replace(/\n+/g, " / "));
    expect(text, "the page should name Acme").toContain(acme.orgName);
    await expect(content.getByRole("heading", { name: "They can see" }), "the page should list what admins can see").toBeVisible();
    await expect(content.getByRole("heading", { name: "They can't see" }), "the page should list what admins can't see").toBeVisible();
    expect(text, "the page should explain the one way in (taking over the account)").toMatch(/taking over this account/i);
    expect(text, "the page should list at least one recent sign-in 'with your password'").toContain("with your password");
    expect(text, "the admin actions should include Max joining").toMatch(/You joined the organization/);
    expect(text, "the admin actions should include the disable").toMatch(/Disabled you/);
    expect(text, "the admin actions should include the re-enable").toMatch(/Re-enabled you/);
    expect(text, "the page should say a sharing policy can't stop an API key being used by whoever holds it").toMatch(/can't stop an API key being used by\s+whoever holds it/);
    await shot(page, testInfo, "E13-01-max-page");
    await context.close();
  });

  await test.step("Gus opens Settings", async () => {
    const { context, page } = await newActor(browser, testInfo, acme.gus, "/app/settings");
    const nav = page.getByRole("navigation", { name: "Settings" });
    await expect(nav.getByRole("link", { name: "Account" }), "Gus's Settings should render its nav").toBeVisible();
    note(testInfo, "E13 Gus settings tabs", (await nav.getByRole("link").allTextContents()).join(" | "));
    await expect(nav.getByRole("link", { name: "Your organization" }), "Gus's Settings should have no 'Your organization' tab").toHaveCount(0);
    await shot(page, testInfo, "E13-02-gus-settings");
    await context.close();
  });
});

// ── E14 ───────────────────────────────────────────────────────────────────

test("E14 private or org-wide when creating a book", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "e14");
  const name = `max-orgwide-${RUN}`;

  await test.step("Max opens Recipe Books, Create, chooses Org-wide, creates the book", async () => {
    const { context, page } = await newActor(browser, testInfo, acme.max, "/app/recipe-books");
    await page.getByRole("button", { name: "+ Create Recipe Book" }).click();
    const group = page.getByRole("group", { name: "Who can see it" });
    await expect(group, "Max should see a 'Who can see it' choice").toBeVisible();
    const privateRadio = group.getByRole("radio", { name: /^Private/ });
    const orgWideRadio = group.getByRole("radio", { name: /^Org-wide/ });
    await expect(privateRadio, "Private should be the default").toBeChecked();
    await expect(orgWideRadio, "Org-wide should start unchecked").not.toBeChecked();
    note(testInfo, "E14 choice text", (await group.innerText()).replace(/\n+/g, " / "));
    await shot(page, testInfo, "E14-01-max-choice");
    await page.getByPlaceholder("Recipe book name").fill(name);
    await orgWideRadio.check();
    await page.getByRole("button", { name: "Create Recipe Book", exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true }), "the new book should appear in Max's list").toBeVisible();
    await context.close();
  });

  await test.step("Olive opens /org/books", async () => {
    const { context, page } = await newActor(browser, testInfo, acme.olive, "/org/books");
    await expect(page.locator("table tbody tr").filter({ hasText: name }), "Max's new book should appear in Olive's org-wide list").toHaveCount(1);
    await shot(page, testInfo, "E14-02-listed-org-wide");
    await context.close();
  });

  await test.step("Gus opens the create form", async () => {
    const { context, page } = await newActor(browser, testInfo, acme.gus, "/app/recipe-books");
    await page.getByRole("button", { name: "+ Create Recipe Book" }).click();
    await expect(page.getByPlaceholder("Recipe book name"), "Gus's create form should open").toBeVisible();
    await expect(page.getByText("Who can see it"), "Gus's form should have no 'Who can see it' choice").toHaveCount(0);
    await shot(page, testInfo, "E14-03-gus-form");
    await context.close();
  });
});

// ── E15 ───────────────────────────────────────────────────────────────────

test("E15 an owner makes an org-wide book private", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e15");
  const name = `max-orgwide15-${RUN}`;
  await createBook(request, acme.max, name, { orgWide: true });
  const privateCard = page.getByText("Private books", { exact: true }).locator("..");
  const privateCount = async () => Number(((await privateCard.textContent()) ?? "").replace(/\D+/g, ""));

  await test.step("Olive clicks Make private on the non-default org-wide book, then reloads", async () => {
    await signIn(page, acme.olive, "/org/books");
    const row = page.locator("table tbody tr").filter({ hasText: name });
    await expect(row, "the fixture book should be listed as org-wide").toHaveCount(1);
    await expect(privateCard, "the private count should have loaded").toContainText(/\d/);
    const before = await privateCount();
    note(testInfo, "E15 private count before", String(before));
    await expect(page.locator("table tbody tr").filter({ hasText: "(default)" }).getByRole("button", { name: "Make private" }), "the default book should have no Make private button").toHaveCount(0);
    await row.getByRole("button", { name: "Make private" }).click();
    await expect(row, "the book should leave the org-wide list").toHaveCount(0);
    await page.reload();
    await expect(page.locator("table tbody tr").filter({ hasText: "(default)" }), "the default book should still be listed").toHaveCount(1);
    await expect(page.locator("table tbody tr").filter({ hasText: name }), "after the reload the book should be gone from the org-wide list").toHaveCount(0);
    await expect.poll(privateCount, { message: "the private count should have gone up by one" }).toBe(before + 1);
    await shot(page, testInfo, "E15-01-made-private");
  });
});

// ── X1 ────────────────────────────────────────────────────────────────────

test("X1 axe scan of the console pages", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "x1");
  const pages: Array<[string, SeededUser, string, RegExp]> = [
    ["org", acme.olive, "/org", /Members/],
    ["org-books", acme.olive, "/org/books", /Recipe books/],
    ["org-activity", acme.olive, "/org/activity", /Activity/],
    ["settings-organization", acme.max, "/app/settings/organization", /What your organization's admins can see/],
    ["admin-organizations", acme.sys, "/admin/organizations", /Organizations/],
  ];
  for (const [label, who, path, heading] of pages) {
    await test.step(`axe ${path}`, async () => {
      const { context, page } = await newActor(browser, testInfo, who, path);
      await expect(page.getByRole("heading", { name: heading }).first(), `${path} should render before the scan`).toBeVisible();
      await page.waitForLoadState("networkidle");
      const f = await axeFindings(page, testInfo, `X1-${label}`);
      note(testInfo, `X1 ${path} serious/critical`, f.blocking.join(" ;; ") || "none");
      note(testInfo, `X1 ${path} moderate`, f.moderate.join(" ;; ") || "none");
      await shot(page, testInfo, `X1-${label}`);
      expect.soft(f.blocking, `${path} should have no serious or critical axe violations`).toEqual([]);
      await context.close();
    });
  }
});

// ── X2 ────────────────────────────────────────────────────────────────────

test("X2 keyboard-only pass on the Books and Members pages", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "x2");

  await test.step("/org/books: Tab to both sharing selects, change one, reach Save and activate it", async () => {
    const { context, page } = await newActor(browser, testInfo, acme.olive, "/org/books");
    const outbound = page.getByRole("combobox", { name: /Our recipe books/ });
    const inbound = page.getByRole("combobox", { name: /Other people's recipe books/ });
    await expect(outbound, "the sharing selects should render").toBeVisible();
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    const isFocused = (l: typeof outbound) => async () => l.evaluate((el) => el === document.activeElement);
    const t1 = await tabTo(page, isFocused(outbound));
    note(testInfo, "X2 tabs to outbound select", String(t1));
    expect(t1, "the outbound select should be reachable with Tab").toBeGreaterThan(0);
    await page.keyboard.press("Tab");
    expect(await isFocused(inbound)(), "the inbound select should be the next Tab stop").toBe(true);
    await page.keyboard.press("ArrowDown");
    await expect(inbound, "ArrowDown on the focused inbound select should change it to blocked").toHaveValue("blocked");
    const save = page.getByRole("button", { name: "Save sharing policy" });
    await page.keyboard.press("Tab");
    expect(await isFocused(save)(), "Save should be the next Tab stop after the inbound select").toBe(true);
    const saved = page.waitForResponse((r) => r.url().includes("/sharing") && r.request().method() === "PATCH");
    await page.keyboard.press("Enter");
    expect((await saved).ok(), "activating Save with Enter should save the policy").toBe(true);
    await page.reload();
    await expect(inbound, "after the reload inbound should read blocked").toHaveValue("blocked");
    await shot(page, testInfo, "X2-01-books-keyboard");
    await context.close();
  });

  await test.step("/org: reach Max's Disable button by keyboard", async () => {
    const { context, page } = await newActor(browser, testInfo, acme.olive, "/org");
    const btn = page.locator("table tbody tr").filter({ hasText: acme.max.email }).getByRole("button", { name: "Disable" });
    await expect(btn, "Max's Disable button should render").toBeVisible();
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    const n = await tabTo(page, async () => btn.evaluate((el) => el === document.activeElement));
    note(testInfo, "X2 tabs to Max's Disable", String(n));
    expect(n, "Max's Disable button should be reachable with Tab").toBeGreaterThan(0);
    await shot(page, testInfo, "X2-02-members-keyboard");
    await context.close();
  });
});

// ── X3 ────────────────────────────────────────────────────────────────────

test("X3 the console and the member's page on a phone @mobile", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "x3");

  await test.step("/org (record only)", async () => {
    const { context, page } = await newActor(browser, testInfo, acme.olive, "/org");
    await expect(page.locator("table tbody tr").filter({ hasText: acme.max.email }), "the Members page should render").toHaveCount(1);
    const m = await horizontalOverflow(page);
    await testInfo.attach("X3-org-overflow.json", { body: JSON.stringify(m), contentType: "application/json" });
    note(testInfo, `X3 /org overflow (${testInfo.project.name})`, JSON.stringify(m));
    await shot(page, testInfo, `X3-01-org-${testInfo.project.name}`);
    await context.close();
  });

  await test.step("/app/settings/organization (assert no overflow)", async () => {
    const { context, page } = await newActor(browser, testInfo, acme.max, "/app/settings/organization");
    await expect(page.getByRole("heading", { name: "What your organization's admins can see" }), "the member's page should render").toBeVisible();
    const m = await assertNoHorizontalScroll(page, testInfo, "X3-settings-organization");
    note(testInfo, `X3 /app/settings/organization overflow (${testInfo.project.name})`, JSON.stringify(m));
    await shot(page, testInfo, `X3-02-settings-organization-${testInfo.project.name}`);
    await context.close();
  });
});

// ── The fixes from the first run ──────────────────────────────────────────

/** Expand a book on Recipe Books by its heading and return its card. */
async function expandBook(page: Page, bookName: string) {
  const heading = page.getByRole("heading", { name: bookName, exact: true });
  await expect(heading, `the book ${bookName} should be listed on Recipe Books`).toBeVisible();
  await heading.click();
  const card = page.locator(".card").filter({ has: heading });
  await expect(card.getByText(/daily agent link defaults/i), `expanding ${bookName} should open its card`).toBeVisible();
  return card;
}

test("E16 an owner makes an existing book org-wide from its own page, and private again", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "e16");
  const name = `max-scope-${RUN}`;
  await createBook(request, acme.max, name);
  const gusBook = `gus-own-${RUN}`;
  await createBook(request, acme.gus, gusBook);
  const { context: maxCtx, page } = await newActor(browser, testInfo, acme.max, "/app/recipe-books");
  const cardOf = () => page.locator(".card").filter({ has: page.getByRole("heading", { name, exact: true }) });

  await test.step("Max expands his private book and finds Who can see it", async () => {
    const card = await expandBook(page, name);
    await expect(card.getByText("Who can see it", { exact: true }), "the book should have a 'Who can see it' section").toBeVisible();
    await expect(card.getByText(/^Private:/), "the section should read Private").toBeVisible();
    await expect(card.getByRole("button", { name: "Make org-wide" }), "the section should offer Make org-wide").toBeVisible();
    await shot(page, testInfo, "E16-01-private");
  });

  await test.step("Max makes it org-wide, then reloads", async () => {
    const resp = page.waitForResponse((r) => r.url().includes("/org-wide") && r.request().method() === "PUT");
    await cardOf().getByRole("button", { name: "Make org-wide" }).click();
    const r = await resp;
    note(testInfo, "E16 make org-wide response", `${r.status()} ${await r.text()}`);
    expect(r.ok(), "making the book org-wide should succeed").toBe(true);
    await page.reload();
    const after = await expandBook(page, name);
    await expect(after.getByText(/^Org-wide:/), "after the reload the section should read org-wide").toBeVisible();
    await expect(after.getByRole("button", { name: "Make private" }), "after the reload the section should offer Make private").toBeVisible();
    await shot(page, testInfo, "E16-02-org-wide-after-reload");
  });

  const { context: oliveCtx, page: olivePage } = await newActor(browser, testInfo, acme.olive, "/org/books");
  await test.step("Olive opens /org/books", async () => {
    await expect(olivePage.locator("table tbody tr").filter({ hasText: name }), "the book should appear in Olive's org-wide list").toHaveCount(1);
    await shot(olivePage, testInfo, "E16-03-listed-for-olive");
  });

  await test.step("Max makes it private again and reloads; it leaves Olive's list", async () => {
    const resp = page.waitForResponse((r) => r.url().includes("/org-wide") && r.request().method() === "PUT");
    await cardOf().getByRole("button", { name: "Make private" }).click();
    expect((await resp).ok(), "making the book private should succeed").toBe(true);
    await page.reload();
    const after = await expandBook(page, name);
    await expect(after.getByText(/^Private:/), "after the reload the section should read Private again").toBeVisible();
    await expect(after.getByRole("button", { name: "Make org-wide" }), "after the reload the section should offer Make org-wide again").toBeVisible();
    await olivePage.reload();
    await expect(olivePage.locator("table tbody tr").filter({ hasText: "(default)" }), "Olive's list should have loaded").toHaveCount(1);
    await expect(olivePage.locator("table tbody tr").filter({ hasText: name }), "the book should have left Olive's org-wide list").toHaveCount(0);
    await shot(olivePage, testInfo, "E16-03b-left-olive-list");
  });

  await test.step("Max expands Acme's default book: no toggle", async () => {
    const card = await expandBook(page, acme.orgName);
    await expect(card.getByText("Who can see it", { exact: true }), "the default book should have no 'Who can see it' section").toHaveCount(0);
    await expect(card.getByRole("button", { name: /Make (org-wide|private)/ }), "the default book should have no Make org-wide/private button").toHaveCount(0);
    await shot(page, testInfo, "E16-04-default-no-toggle");
  });
  await test.step("extra: Olive (an admin of the default book) expands it: no toggle either", async () => {
    // Max is only a member of the default book, so his view can't tell the
    // default-book rule from the owner/admin rule; Olive's can.
    await olivePage.goto("/app/recipe-books");
    const card = await expandBook(olivePage, acme.orgName);
    await expect(card.getByText("Who can see it", { exact: true }), "the default book should have no 'Who can see it' section even for its owner/admin").toHaveCount(0);
    await expect(card.getByRole("button", { name: /Make (org-wide|private)/ }), "the default book should have no Make org-wide/private button even for its owner/admin").toHaveCount(0);
    await shot(olivePage, testInfo, "E16-04b-default-no-toggle-olive");
  });
  await oliveCtx.close();
  await maxCtx.close();

  await test.step("Gus expands his own book: no section", async () => {
    const { context, page: gp } = await newActor(browser, testInfo, acme.gus, "/app/recipe-books");
    const card = await expandBook(gp, gusBook);
    await expect(card.getByText("Who can see it", { exact: true }), "Gus's personal book should have no 'Who can see it' section").toHaveCount(0);
    await expect(card.getByRole("button", { name: /Make (org-wide|private)/ }), "Gus's book should have no Make org-wide/private button").toHaveCount(0);
    await shot(gp, testInfo, "E16-05-gus-no-section");
    await context.close();
  });
});

/** Is the element fully inside the first table's scroll box and the viewport, with the box unscrolled? */
async function inViewOfTable(page: Page, el: ReturnType<Page["locator"]>) {
  const box = await page.locator("table").first().evaluate((t) => {
    const w = t.parentElement as HTMLElement;
    const r = w.getBoundingClientRect();
    return { left: r.left, right: r.right, scrollLeft: w.scrollLeft, boxWidth: w.clientWidth, tableWidth: t.scrollWidth };
  });
  const r = await el.evaluate((e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right }; });
  const vw = page.viewportSize()!.width;
  return { ...box, elLeft: r.left, elRight: r.right, viewport: vw, inView: box.scrollLeft === 0 && r.left >= box.left && r.right <= box.right && r.right <= vw };
}

test("E17a the role select on /org shows its value legibly", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e17a");
  await signIn(page, acme.olive, "/org");
  const sel = page.locator("table tbody tr").filter({ hasText: acme.max.email }).getByRole("combobox", { name: `Role for ${acme.max.email}` });
  await expect(sel, "Max's row should offer a role select to Olive").toBeVisible();
  await expect(sel, "the select's value should be member").toHaveValue("member");
  const m = await sel.evaluate((el) => {
    const s = el as HTMLSelectElement;
    const cs = getComputedStyle(s);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = s.selectedOptions[0]?.text ?? "";
    const content = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { text, textWidth: Math.round(ctx.measureText(text).width), contentWidth: Math.round(content), width: Math.round(s.getBoundingClientRect().width), color: cs.color, background: cs.backgroundColor };
  });
  note(testInfo, "E17a role select measurement", JSON.stringify(m));
  expect(m.text, "the selected option should read Member").toBe("Member");
  expect(m.contentWidth, "the select should be wide enough to show 'Member' (content width at least the text width)").toBeGreaterThanOrEqual(m.textWidth);
  await shot(page, testInfo, "E17-a-role-select");
});

test("E17b the book form's radios sit beside their labels", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e17b");
  await signIn(page, acme.max, "/app/recipe-books");
  await page.getByRole("button", { name: "+ Create Recipe Book" }).click();
  const group = page.getByRole("group", { name: "Who can see it" });
  await expect(group, "Max should see the Who can see it choice").toBeVisible();
  for (const label of ["Private", "Org-wide"]) {
    const radio = group.getByRole("radio", { name: new RegExp(`^${label}`) });
    const m = await radio.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const lbl = el.closest("label")!;
      const textNode = [...lbl.childNodes].find((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0)!;
      const start = (textNode.textContent ?? "").search(/\S/);
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + 1);
      const t = range.getBoundingClientRect();
      return { radioWidth: Math.round(b.width), radioRight: Math.round(b.right), radioMidY: Math.round(b.top + b.height / 2), textLeft: Math.round(t.left), textMidY: Math.round(t.top + t.height / 2) };
    });
    note(testInfo, `E17b ${label} radio vs first letter of its label`, JSON.stringify(m));
    expect(m.radioWidth, `the ${label} radio should be its natural size, not stretched`).toBeLessThan(40);
    expect(Math.abs(m.radioMidY - m.textMidY), `the ${label} radio should sit on the same line as its label text`).toBeLessThan(12);
    expect(m.textLeft, `the ${label} label text should start right of its radio`).toBeGreaterThanOrEqual(m.radioRight);
    expect(m.textLeft - m.radioRight, `the ${label} label text should be beside the radio, not far away`).toBeLessThan(24);
  }
  await shot(page, testInfo, "E17-b-radios");
});

test("E17c Max's Disable button is in view on /org at 1440px", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e17c");
  await signIn(page, acme.olive, "/org");
  const btn = page.locator("table tbody tr").filter({ hasText: acme.max.email }).getByRole("button", { name: "Disable" });
  await expect(btn, "Max's Disable button should render").toBeVisible();
  const m = await inViewOfTable(page, btn);
  note(testInfo, "E17c measurement", JSON.stringify(m));
  note(testInfo, "E17c headers", (await tableHeaders(page)).join(" | "));
  expect(m.inView, "Max's Disable button should be visible without scrolling the table").toBe(true);
  await shot(page, testInfo, "E17-c-disable-in-view");
});

test("E17d the seat-limit input is in view on /admin/organizations at 1440px", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e17d");
  await signIn(page, acme.sys, "/admin/organizations");
  const input = page.getByRole("spinbutton", { name: `Seat limit for ${acme.orgName}` });
  await expect(input, "the organization's seat-limit input should render").toBeVisible();
  const m = await inViewOfTable(page, input);
  note(testInfo, "E17d measurement", JSON.stringify(m));
  note(testInfo, "E17d headers", (await tableHeaders(page)).join(" | "));
  expect(m.inView, "the seat-limit input should be visible without scrolling the table").toBe(true);
  await shot(page, testInfo, "E17-d-seat-limit-in-view");
});

test("E17e the site operator's org member view shows labels, not codes", async ({ page, request }, testInfo) => {
  const acme = await setupAcme(request, "e17e");
  await signIn(page, acme.sys, "/admin/organizations");
  await page.getByRole("link", { name: acme.orgName }).click();
  await expect(page.getByRole("heading", { name: "Organization members" }), "the members view should open").toBeVisible();
  await expect(page.locator("table tbody tr"), "the members view should list three members").toHaveCount(3);
  const headers = await tableHeaders(page);
  const row = page.locator("table tbody tr").filter({ hasText: acme.max.email });
  const cell = (h: string) => row.locator("td").nth(headers.indexOf(h));
  note(testInfo, "E17e headers", headers.join(" | "));
  note(testInfo, "E17e all rows", (await page.locator("table tbody tr").allTextContents()).join(" || "));
  await expect(cell("Status"), "Status should read Active").toHaveText("Active");
  await expect(cell("Role"), "Role should read Member").toHaveText("Member");
  await expect(cell("Joined via"), "Joined via should read Added by Soup.net").toHaveText("Added by Soup.net");
  const olive = page.locator("table tbody tr").filter({ hasText: acme.olive.email });
  await expect(olive.locator("td").nth(headers.indexOf("Joined via")), "Olive's Joined via should read Named at creation").toHaveText("Named at creation");
  await shot(page, testInfo, "E17-e-site-labels");
});

test("E17f the org console's eyebrow and access-denied heading read Organization", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "e17f");
  const { context, page } = await newActor(browser, testInfo, acme.olive, "/org");
  for (const [path, title] of [["/org", "Members"], ["/org/books", "Recipe books"], ["/org/activity", "Activity"]] as const) {
    await test.step(`eyebrow on ${path}`, async () => {
      if (path !== "/org") await page.goto(path);
      const h1 = page.getByRole("heading", { level: 1, name: title });
      await expect(h1, `${path} should render its title`).toBeVisible();
      const eyebrow = await h1.evaluate((h) => (h.previousElementSibling?.textContent ?? "").trim());
      note(testInfo, `E17f eyebrow on ${path}`, eyebrow);
      expect(eyebrow, `the small label above ${path}'s title should read Organization`).toBe("Organization");
      if (path === "/org") await shot(page, testInfo, "E17-f-org-eyebrow");
    });
  }
  await context.close();
  await test.step("Max's access-denied heading", async () => {
    const { context: mc, page: mp } = await newActor(browser, testInfo, acme.max, "/org");
    await expect(mp.getByText(/You don't have access to this page/), "Max should be denied").toBeVisible();
    await expect(mp.getByRole("heading", { level: 1 }), "the access-denied heading should read Organization").toHaveText("Organization");
    await shot(mp, testInfo, "E17-f2-denied-heading");
    await mc.close();
  });
});

test("E17g axe reports no nested-main violations on the console pages", async ({ browser, request }, testInfo) => {
  const acme = await setupAcme(request, "e17g");
  const NESTED = /^(landmark-main-is-top-level|landmark-no-duplicate-main|landmark-unique) /;
  const pages: Array<[string, SeededUser, string, RegExp]> = [
    ["org", acme.olive, "/org", /Members/],
    ["org-books", acme.olive, "/org/books", /Recipe books/],
    ["org-activity", acme.olive, "/org/activity", /Activity/],
    ["admin-organizations", acme.sys, "/admin/organizations", /Organizations/],
  ];
  for (const [label, who, path, heading] of pages) {
    await test.step(`axe ${path}`, async () => {
      const { context, page } = await newActor(browser, testInfo, who, path);
      await expect(page.getByRole("heading", { name: heading }).first(), `${path} should render before the scan`).toBeVisible();
      await page.waitForLoadState("networkidle");
      const f = await axeFindings(page, testInfo, `E17g-${label}`);
      const all = [...f.blocking, ...f.moderate, ...f.minor];
      note(testInfo, `E17g ${path} all violations`, all.join(" ;; ") || "none");
      expect.soft(all.filter((v) => NESTED.test(v)), `${path} should have no nested-main landmark violations`).toEqual([]);
      expect.soft(f.blocking, `${path} should have no serious or critical violations`).toEqual([]);
      await context.close();
    });
  }
});
