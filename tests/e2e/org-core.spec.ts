import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import postgres from "postgres";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, signInNewContext, type SeededUser } from "./helpers/accounts";
import { assertNoHorizontalScroll, axeFindings, shot } from "./helpers/evidence";

// Organization accounts, stream Core: the key form's limit, login refusals,
// sign-out when a session is refused, self-deletion, and books in a company.
// Cast: Sys (site operator), Olive (Acme's owner), Max (Acme member), Gus (ordinary).
// Accounts: e2e-org-core-<test>-<role>-*@test.local, fresh per test.
//
// Tests whose subject is a session ending sign in on the real form, not with
// signIn(): signIn's init script writes the token back on every navigation,
// which would hide a sign-out behind the next reload.
//
// The only SQL: users.role = 'system' for Sys and users.sessions_valid_after
// for E17, in the stack's own database.

const MAILPIT = "http://127.0.0.1:8625";

const DISABLED_COPY = "Your organization has disabled this account. Ask one of its admins to turn it back on.";
const SUSPENDED_COPY = "This account is suspended. Contact Soup.net support.";
const MANAGED_DELETE_COPY = "Your organization manages this account. Ask one of its admins.";
const RAW_CODES = /account_disabled|account_suspended|key_lifetime_cap|managed_account|session_expired|sso_required|organization_full/;
const SNAKE_CODE = /\b[a-z]+(?:_[a-z]+)+\b/;
const BROKEN_VALUE = /\bundefined\b|\[object Object\]|\bNaN\b|Invalid Date/;
const ORG_WORDING = /\borganization\b|\bmanaged\b|90[- ]day/i;

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let seq = 0;
const unique = (what: string) => `${what}-${RUN}-${++seq}`;

test.describe.configure({ timeout: 240_000 });

// ── SQL fixtures

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

async function promoteToOperator(email: string): Promise<void> {
  const sql = postgres({ ...dbSettings(), max: 1, onnotice: () => {} });
  try {
    const rows = await sql`UPDATE claimnet.users SET role = 'system' WHERE email = ${email} RETURNING id`;
    expect(rows.length, `fixture: promoting ${email} should update exactly one row`).toBe(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function stampSessionCutOff(email: string, epochSeconds: number): Promise<void> {
  const sql = postgres({ ...dbSettings(), max: 1, onnotice: () => {} });
  try {
    const rows = await sql`UPDATE claimnet.users SET sessions_valid_after = to_timestamp(${epochSeconds}) WHERE email = ${email} RETURNING id`;
    expect(rows.length, `fixture: stamping the cut-off on ${email} should update exactly one row`).toBe(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ── API fixtures

interface Actor extends SeededUser {
  id: string;
}

interface Book {
  id: string;
  name: string;
  slug: string;
  organization_id: string;
  member_role: string;
}

async function me(request: APIRequestContext, token: string) {
  const r = await request.get(`${BACKEND_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status(), body: await r.json() };
}

async function actor(request: APIRequestContext, label: string): Promise<Actor> {
  const user = await seedUser(request, `org-core-${label}`);
  const m = await me(request, user.token);
  expect(m.status, `fixture: /auth/me for ${user.email} should answer`).toBe(200);
  return { ...user, id: m.body.data.user.id as string };
}

async function operator(request: APIRequestContext, label: string): Promise<Actor> {
  const user = await actor(request, `${label}-sys`);
  await promoteToOperator(user.email);
  // The role travels in the session, so the operator signs in again.
  const login = await request.post(`${BACKEND_URL}/auth/login`, { data: { email: user.email, password: user.password } });
  const body = await login.json();
  expect(login.ok(), `fixture: the operator should sign in; got ${login.status()}`).toBe(true);
  return { ...user, token: body.data.token as string };
}

interface Company {
  sys: Actor;
  olive: Actor;
  orgId: string;
  orgName: string;
  defaultBookId: string;
}

async function company(request: APIRequestContext, label: string): Promise<Company> {
  const sys = await operator(request, label);
  const olive = await actor(request, `${label}-olive`);
  const orgName = `Acme ${unique(label)}`;
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const r = await request.post(`${BACKEND_URL}/admin/organizations`, { headers: asUser(sys), data: { name: orgName, slug, ownerEmail: olive.email } });
  const body = await r.json();
  expect(r.status(), `fixture: the operator should create the organization; got ${JSON.stringify(body)}`).toBe(201);
  return { sys, olive, orgId: body.data.organizationId, orgName, defaultBookId: body.data.defaultRecipeBookId };
}

async function addToCompany(request: APIRequestContext, acme: Company, who: SeededUser, role: "owner" | "admin" | "member" = "member") {
  const r = await request.post(`${BACKEND_URL}/admin/organizations/${acme.orgId}/members`, { headers: asUser(acme.sys), data: { email: who.email, role } });
  const body = await r.json();
  expect(r.status(), `fixture: the operator should add ${who.email}; got ${JSON.stringify(body)}`).toBe(201);
  return body.data as { userId: string; movedBooks: Array<{ name: string; slug: string; previousSlug: string }> };
}

async function setMemberEnabled(request: APIRequestContext, acme: Company, who: Actor, enabled: boolean) {
  const r = await request.post(`${BACKEND_URL}/organizations/${acme.orgId}/members/${who.id}/${enabled ? "enable" : "disable"}`, { headers: asUser(acme.olive) });
  expect(r.status(), `fixture: Olive should ${enabled ? "enable" : "disable"} ${who.email}; got ${await r.text()}`).toBe(200);
}

async function setSuspended(request: APIRequestContext, sys: Actor, who: Actor, suspended: boolean) {
  const r = await request.post(`${BACKEND_URL}/admin/users/${who.id}/${suspended ? "suspend" : "unsuspend"}`, { headers: asUser(sys), data: {} });
  expect(r.status(), `fixture: the operator should ${suspended ? "suspend" : "unsuspend"} ${who.email}; got ${await r.text()}`).toBe(200);
}

async function booksOf(request: APIRequestContext, u: SeededUser): Promise<Book[]> {
  const r = await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(u) });
  return (await r.json()).data as Book[];
}

async function keysOf(request: APIRequestContext, u: SeededUser) {
  const r = await request.get(`${BACKEND_URL}/keys`, { headers: asUser(u) });
  return (await r.json()).data as Array<{ id: string; keyPrefix: string; label: string | null; expiresAt: string; keyType: string }>;
}

async function mintByApi(request: APIRequestContext, u: SeededUser, days: number, label: string) {
  const ids = (await booksOf(request, u)).map((b) => b.id);
  const r = await request.post(`${BACKEND_URL}/keys/scoped`, {
    headers: asUser(u),
    data: { readRecipeBookIds: ids, writeRecipeBookIds: ids, defaultWriteRecipeBookId: ids[0], expiresAt: new Date(Date.now() + days * 864e5).toISOString(), label },
  });
  const body = await r.json();
  expect(r.ok(), `fixture: minting "${label}" should succeed; got ${r.status()} ${JSON.stringify(body)}`).toBe(true);
  return body.data as { key: string; expiresAt: string };
}

async function createBookByApi(request: APIRequestContext, u: SeededUser, name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const r = await request.post(`${BACKEND_URL}/recipe-books`, { headers: asUser(u), data: { name, slug } });
  const body = await r.json();
  expect(r.status(), `fixture: creating "${name}" should succeed; got ${JSON.stringify(body)}`).toBe(201);
  return body.data as { id: string; name: string; slug: string };
}

async function shareBook(request: APIRequestContext, owner: SeededUser, bookId: string, who: SeededUser) {
  const r = await request.post(`${BACKEND_URL}/recipe-books/${bookId}/members`, { headers: asUser(owner), data: { email: who.email, role: "member" } });
  expect(r.status(), `fixture: sharing the book with ${who.email} should succeed; got ${await r.text()}`).toBe(201);
}

/** A key call that any live key answers: the keyed /check page in JSON. */
async function callWithKey(request: APIRequestContext, key: string) {
  const r = await request.get(`${BACKEND_URL}/check?key=${encodeURIComponent(key)}&filter=launch&format=json`, { headers: { Accept: "application/json" } });
  return { status: r.status(), body: await r.text() };
}

async function mcpWithKey(request: APIRequestContext, key: string) {
  const r = await request.post(`${BACKEND_URL}/mcp`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  return { status: r.status(), body: await r.text() };
}

async function mailTo(request: APIRequestContext, address: string, subject: RegExp) {
  let found: { ID: string; Subject: string } | undefined;
  await expect
    .poll(
      async () => {
        const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
        const list = (await r.json()) as { messages: Array<{ ID: string; Subject: string }> };
        found = list.messages.find((m) => subject.test(m.Subject));
        return !!found;
      },
      { message: `an email matching ${subject} should reach ${address}`, timeout: 20_000 },
    )
    .toBe(true);
  const r = await request.get(`${MAILPIT}/api/v1/message/${found!.ID}`);
  return (await r.json()) as { Subject: string; Text: string; HTML: string };
}

// ── Page helpers

function note(testInfo: TestInfo, type: "open" | "observed" | "finding", description: string) {
  testInfo.annotations.push({ type, description });
}

const isPhone = (testInfo: TestInfo) => testInfo.project.name === "mobile";

/** Signed-out preparation: what signIn() does minus the token. */
async function prep(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cookie_notice_dismissed", "true");
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".tsqd-open-btn-container, .tsqd-parent-container, [data-tanstack-query-devtools] { display: none !important; }";
      document.head.appendChild(style);
    });
  });
}

const sessionToken = (page: Page) => page.evaluate(() => localStorage.getItem("claimnet_token"));

async function submitLogin(page: Page, email: string, password: string) {
  await page.goto("/auth/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/auth/login") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Sign In", exact: true }).click(),
  ]);
}

async function signInOnForm(page: Page, user: SeededUser) {
  await submitLogin(page, user.email, user.password);
  await expect(page, `${user.email} should reach the dashboard from the real login form`).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByRole("main"), "the dashboard should render").toBeVisible();
  await page.waitForLoadState("networkidle");
}

const loginError = (page: Page) => page.locator("form p").first();

async function expectOnLoginSignedOut(page: Page, what: string) {
  await expect(page, `${what}: the person should be on the login page`).toHaveURL(/\/auth\/login/);
  await expect(page.locator("#email"), `${what}: the login form should be whole`).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In", exact: true }), `${what}: the Sign In button should be there`).toBeVisible();
  expect(await sessionToken(page), `${what}: the session token should be gone`).toBeNull();
}

async function expectNoRawCode(page: Page, what: string, strict = true) {
  const text = await page.locator("body").innerText();
  expect(text, `${what}: no raw error code should appear on the page`).not.toMatch(RAW_CODES);
  if (strict) expect(text, `${what}: no snake_case code should appear on the page`).not.toMatch(SNAKE_CODE);
}

/** Through the shell's navigation, without a page load. */
async function clientNav(page: Page, testInfo: TestInfo, label: "API Keys" | "Recipe Books" | "Settings" | "Dashboard") {
  if (isPhone(testInfo)) {
    if (label === "API Keys" || label === "Settings") {
      await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "More" }).click();
      await page.getByRole("dialog", { name: "More navigation" }).getByRole("link", { name: label }).click();
    } else {
      await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: label }).click();
    }
  } else {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: label }).click();
  }
}

/** API Keys reads queries the dashboard just loaded, so within their stale time it sends nothing. */
async function recordCachedNav(page: Page, testInfo: TestInfo) {
  const sent: string[] = [];
  const onRequest = (r: { url(): string; method(): string }) => {
    if (r.url().startsWith(BACKEND_URL)) sent.push(`${r.method()} ${r.url().slice(BACKEND_URL.length)}`);
  };
  page.on("request", onRequest);
  await clientNav(page, testInfo, "API Keys");
  await page.waitForTimeout(1500);
  page.off("request", onRequest);
  note(testInfo, "observed", `Disabled, navigating to API Keys with the dashboard's data still fresh: URL ${page.url()}; requests sent: ${sent.join(", ") || "none"}; page heading visible: ${await page.getByRole("heading", { name: "API Keys", level: 1 }).count() > 0}.`);
}

const markWindow = (page: Page) => page.evaluate(() => { (window as unknown as { __orgCore?: boolean }).__orgCore = true; });
const windowMarked = (page: Page) => page.evaluate(() => (window as unknown as { __orgCore?: boolean }).__orgCore === true);

async function openKeyForm(page: Page) {
  await page.goto("/app/keys");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Create Key/ }).click();
  await expect(page.locator("#scopedDays"), "the scoped-key form should open with a days field").toBeVisible();
}

const generateButton = (page: Page) => page.getByRole("button", { name: "Generate Key", exact: true });

async function submitKeyForm(page: Page, label: string, days: number) {
  await page.locator("#scopedLabel").fill(label);
  await page.locator("#scopedDays").fill(String(days));
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/keys/scoped") && r.request().method() === "POST"),
    generateButton(page).click(),
  ]);
  return resp;
}

function keyRow(page: Page, label: string): Locator {
  return page.locator("span.text-xs").filter({ hasText: label }).locator("..");
}

async function expectRowExpiry(page: Page, label: string, days: number) {
  const row = keyRow(page, label);
  await expect(row, `the key "${label}" should be listed`).toBeVisible();
  const text = (await row.innerText()).replace(/\s+/g, " ");
  const shown = /expires (\S+)/.exec(text)?.[1];
  expect(shown, `the key "${label}" should show an expiry`).toBeTruthy();
  const ahead = await page.evaluate((s) => (new Date(s).getTime() - Date.now()) / 864e5, shown!);
  expect(ahead, `the key "${label}" should expire about ${days} days ahead (page says ${shown})`).toBeGreaterThan(days - 1.1);
  expect(ahead, `the key "${label}" should expire about ${days} days ahead (page says ${shown})`).toBeLessThan(days + 0.1);
}

const rawKeyOnPage = async (page: Page) => {
  const input = page.locator("input[readonly].text-mono").first();
  await expect(input, "the just-minted key should be shown once").toBeVisible();
  return input.inputValue();
};

async function describeKeyField(page: Page) {
  const days = page.locator("#scopedDays");
  const card = page.locator(".card").filter({ hasText: "New API Key" });
  return {
    type: await days.getAttribute("type"),
    min: await days.getAttribute("min"),
    max: await days.getAttribute("max"),
    value: await days.inputValue(),
    selects: await days.locator("..").locator("select").count(),
    durationRadios: await days.locator("..").locator('input[type="radio"]').count(),
    formText: (await card.innerText()).replace(/\s+/g, " "),
  };
}

async function startDelete(page: Page, password: string) {
  await page.getByRole("button", { name: /Delete my account/ }).click();
  await page.locator("#delete-confirm-password").fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/auth/me") && r.request().method() === "DELETE"),
    page.getByRole("button", { name: "Permanently delete" }).click(),
  ]);
}

async function createBookInUi(page: Page, name: string) {
  await page.goto("/app/recipe-books");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "+ Create Recipe Book" }).click();
  await page.getByPlaceholder("Recipe book name").fill(name);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/recipe-books") && r.request().method() === "POST"),
    page.getByRole("main").getByRole("button", { name: "Create Recipe Book", exact: true }).click(),
  ]);
  return resp;
}

const bookCard = (page: Page, name: string) => page.locator(".card").filter({ has: page.getByRole("heading", { name, exact: true }) });

// ── The API keys page

test("E1 a managed account's key form stops at 90 days @mobile", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e1");
  const max = await actor(request, "e1-max");
  await addToCompany(request, acme, max);
  await signIn(page, max, "/app/keys");

  await test.step("open the form and list every expiry choice", async () => {
    await openKeyForm(page);
    const f = await describeKeyField(page);
    note(testInfo, "observed", `Expiry control: type=${f.type} min=${f.min} max=${f.max} default=${f.value}; selects=${f.selects}; radios=${f.durationRadios}.`);
    expect(f.selects + f.durationRadios, "no preset past 90 days: the form should offer no such preset").toBe(0);
    expect(f.max, "the days field should state 90 as its maximum").toBe("90");
    expect(Number(f.value), "the default choice should be at or under 90").toBeLessThanOrEqual(90);
    note(testInfo, "open", /90/.test(f.formText) ? `The form mentions the limit: ${f.formText}` : `The form's visible text says nothing about the 90-day limit. Text: "${f.formText}"`);
    await shot(page, testInfo, "E1-01-managed-key-form");
  });

  await test.step("reload and look again", async () => {
    await page.reload();
    await openKeyForm(page);
    const f = await describeKeyField(page);
    expect(f.max, "after a reload the days field should still state 90 as its maximum").toBe("90");
    expect(Number(f.value), "after a reload the default should still be at or under 90").toBeLessThanOrEqual(90);
    await shot(page, testInfo, "E1-02-managed-key-form-after-reload");
  });
});

test("E2 a managed account can mint at the limit", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e2");
  const max = await actor(request, "e2-max");
  await addToCompany(request, acme, max);
  await signIn(page, max, "/app/keys");
  let key90 = "";

  await test.step("mint an 80-day key through the form", async () => {
    await openKeyForm(page);
    const resp = await submitKeyForm(page, "e2-eighty", 80);
    expect(resp.status(), "an 80-day key for a managed account should be minted").toBe(200);
    await expectRowExpiry(page, "e2-eighty", 80);
    const key = await rawKeyOnPage(page);
    expect((await callWithKey(request, key)).status, "the minted 80-day key should work against the backend").toBe(200);
  });

  await test.step("mint a key at exactly 90 days", async () => {
    await page.getByRole("button", { name: /Create Key/ }).click();
    const resp = await submitKeyForm(page, "e2-ninety", 90);
    expect(resp.status(), "a 90-day key for a managed account should be minted").toBe(200);
    await expectRowExpiry(page, "e2-ninety", 90);
    key90 = await rawKeyOnPage(page);
    await shot(page, testInfo, "E2-01-managed-key-minted-at-90");
  });

  await test.step("both stay listed after a reload, and the key works", async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expectRowExpiry(page, "e2-eighty", 80);
    await expectRowExpiry(page, "e2-ninety", 90);
    expect((await callWithKey(request, key90)).status, "the 90-day key should work against the backend").toBe(200);
    await shot(page, testInfo, "E2-02-after-reload");
  });
});

test("E3 a managed account can't go over the limit by typing", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e3");
  const max = await actor(request, "e3-max");
  await addToCompany(request, acme, max);
  await signIn(page, max, "/app/keys");

  for (const [days, name] of [[91, "E3-01-91-days-refused"], [120, "E3-02-120-days-refused"]] as const) {
    await test.step(`type ${days} and click Generate Key`, async () => {
      await page.reload();
      await openKeyForm(page);
      const resp = await submitKeyForm(page, `e3-${days}`, days);
      expect(resp.status(), `${days} days should be refused by the backend`).toBe(400);
      await expect(page.getByText(/at most 90 days/), `the person should see a message naming 90 days after ${days} days`).toBeVisible();
      await expectNoRawCode(page, `${days} days refused`, false);
      expect((await keysOf(request, max)).length, `${days} days should create no key`).toBe(0);
      await shot(page, testInfo, name);
    });
  }
});

test("E4 the form was opened before the person became managed", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e4");
  const gus = await actor(request, "e4-gus");
  await signIn(page, gus, "/app/keys");

  await test.step("Gus opens the form, then becomes managed without reloading", async () => {
    await openKeyForm(page);
    expect((await describeKeyField(page)).max, "before joining, the form follows the one-year ceiling").toBe("365");
    await addToCompany(request, acme, gus);
    await page.waitForTimeout(500);
    note(testInfo, "open", `The form after he joined, not reloaded: max=${(await describeKeyField(page)).max} (it does not update unless this says 90).`);
  });

  await test.step("he asks for more than 90 days and submits", async () => {
    const resp = await submitKeyForm(page, "e4-stale", 120);
    expect(resp.status(), "the backend should refuse an over-limit key from a stale form").toBe(400);
    await expect(page.getByText(/90 days/), "what he sees should name 90 days").toBeVisible();
    note(testInfo, "observed", `Refusal shown: "${await page.getByText(/90 days/).innerText()}"`);
    await expectNoRawCode(page, "stale form refused", false);
    expect((await keysOf(request, gus)).length, "no over-limit key should be created").toBe(0);
    await shot(page, testInfo, "E4-01-stale-form-refused");
  });

  await test.step("after a reload the form follows E1", async () => {
    await page.reload();
    await openKeyForm(page);
    expect((await describeKeyField(page)).max, "after a reload the form should state 90 as its maximum").toBe("90");
    await shot(page, testInfo, "E4-02-after-reload");
  });
});

test("E5 an ordinary account keeps its full range @mobile", async ({ page, request }, testInfo) => {
  const gus = await actor(request, "e5-gus");
  await signIn(page, gus, "/app/keys");

  await test.step("list every expiry choice", async () => {
    await openKeyForm(page);
    const f = await describeKeyField(page);
    note(testInfo, "observed", `Expiry control: type=${f.type} min=${f.min} max=${f.max} default=${f.value}; selects=${f.selects}; radios=${f.durationRadios}.`);
    expect(f.max, "an ordinary account's days field should allow up to 365").toBe("365");
    expect(await page.locator("body").innerText(), "no text about an organization or a 90-day limit should appear").not.toMatch(ORG_WORDING);
    await shot(page, testInfo, "E5-01-ordinary-key-form");
  });

  await test.step("mint a 120-day key", async () => {
    const resp = await submitKeyForm(page, "e5-onetwenty", 120);
    expect(resp.status(), "a 120-day key for an ordinary account should be minted").toBe(200);
    await expectRowExpiry(page, "e5-onetwenty", 120);
    await shot(page, testInfo, "E5-02-ordinary-key-minted-120");
  });

  await test.step("mint a key at exactly 365 days", async () => {
    await page.getByRole("button", { name: /Create Key/ }).click();
    const resp = await submitKeyForm(page, "e5-ceiling", 365);
    expect(resp.status(), "a 365-day key for an ordinary account should be minted").toBe(200);
    await expectRowExpiry(page, "e5-ceiling", 365);
  });

  await test.step("both stay listed after a reload", async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expectRowExpiry(page, "e5-onetwenty", 120);
    await expectRowExpiry(page, "e5-ceiling", 365);
    await shot(page, testInfo, "E5-03-ordinary-key-ceiling");
  });

  await test.step("366 days is refused or prevented", async () => {
    await page.getByRole("button", { name: /Create Key/ }).click();
    const resp = await submitKeyForm(page, "e5-toolong", 366);
    expect(resp.status(), "366 days should be refused").toBe(400);
    const message = await page.locator(".card").filter({ hasText: "New API Key" }).locator("p").last().innerText();
    note(testInfo, "observed", `366 days shows: "${message}"`);
    expect(message, "the 366-day refusal should not mention an organization or a 90-day limit").not.toMatch(ORG_WORDING);
    expect((await keysOf(request, gus)).length, "366 days should create no key").toBe(2);
  });
});

test("E6 joining isn't retroactive for keys", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e6");
  const max = await actor(request, "e6-max");
  const minted = await mintByApi(request, max, 120, "e6-long");

  await test.step("the operator adds him to Acme", async () => {
    await addToCompany(request, acme, max);
  });

  await test.step("he opens the API keys page", async () => {
    await signIn(page, max, "/app/keys");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Failed to load keys."), "the page should not error").toHaveCount(0);
    await expectRowExpiry(page, "e6-long", 120);
    const listed = (await keysOf(request, max)).find((k) => k.label === "e6-long");
    expect(new Date(listed!.expiresAt).getTime(), "the key should keep its original expiry").toBe(new Date(minted.expiresAt).getTime());
    expect((await callWithKey(request, minted.key)).status, "the long key minted before joining should still work").toBe(200);
    await shot(page, testInfo, "E6-01-long-key-kept-after-join");
  });
});

// ── Login page messages

test("E7 a disabled member signing in with the right password @mobile", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e7");
  const max = await actor(request, "e7-max");
  await addToCompany(request, acme, max);
  await setMemberEnabled(request, acme, max, false);
  await prep(page);

  await test.step("the correct password on the real form", async () => {
    await submitLogin(page, max.email, max.password);
    await expect(page.getByText(DISABLED_COPY, { exact: true }), "the disabled copy should show, verbatim").toBeVisible();
    await expectNoRawCode(page, "disabled sign-in");
    await expectOnLoginSignedOut(page, "disabled sign-in");
    await shot(page, testInfo, "E7-01-login-disabled-message");
  });

  await test.step("reload", async () => {
    await page.reload();
    await expect(page.getByText(DISABLED_COPY, { exact: true }), "reloading should clear the message").toHaveCount(0);
    await expectOnLoginSignedOut(page, "after reload");
  });
});

test("E8 a disabled member with the wrong password", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e8");
  const max = await actor(request, "e8-max");
  const control = await actor(request, "e8-control");
  await addToCompany(request, acme, max);
  await setMemberEnabled(request, acme, max, false);
  await prep(page);
  let ordinary = "";

  await test.step("control: an ordinary account's wrong password", async () => {
    await submitLogin(page, control.email, "wrong-password-999");
    await expect(loginError(page), "an ordinary wrong password should show a message").toBeVisible();
    ordinary = await loginError(page).innerText();
    note(testInfo, "observed", `Ordinary wrong password: "${ordinary}"`);
  });

  await test.step("the disabled member's wrong password", async () => {
    await submitLogin(page, max.email, "wrong-password-999");
    await expect(loginError(page), "a message should show").toBeVisible();
    expect(await loginError(page).innerText(), "the message should match an ordinary wrong password").toBe(ordinary);
    await expect(page.getByText(DISABLED_COPY), "the disabled state should not be revealed").toHaveCount(0);
    await shot(page, testInfo, "E8-01-login-disabled-wrong-password");
  });
});

test("E9 re-enabled, the same person signs in", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e9");
  const max = await actor(request, "e9-max");
  await addToCompany(request, acme, max);
  await setMemberEnabled(request, acme, max, false);
  await setMemberEnabled(request, acme, max, true);
  await prep(page);

  await test.step("sign in on the real form", async () => {
    await signInOnForm(page, max);
    await expect(page.getByText(DISABLED_COPY), "there should be no refusal").toHaveCount(0);
    await shot(page, testInfo, "E9-01-reenabled-signed-in");
  });
});

test("E10 a suspended account signing in @mobile", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e10");
  const max = await actor(request, "e10-max");
  const gus = await actor(request, "e10-gus");
  await addToCompany(request, acme, max);
  await setSuspended(request, acme.sys, max, true);
  await setSuspended(request, acme.sys, gus, true);
  await prep(page);

  for (const [who, name] of [[max, "E10-01-login-suspended-message"], [gus, "E10-02-login-suspended-personal"]] as const) {
    await test.step(`the correct password for ${who === max ? "Max (managed)" : "Gus (personal)"}`, async () => {
      await submitLogin(page, who.email, who.password);
      await expect(page.getByText(SUSPENDED_COPY, { exact: true }), "the suspended copy should show, verbatim").toBeVisible();
      await expectNoRawCode(page, "suspended sign-in");
      expect(await page.locator("body").innerText(), "the page should not say the organization did it").not.toMatch(/organi[sz]ation/i);
      await expectOnLoginSignedOut(page, "suspended sign-in");
      await shot(page, testInfo, name);
    });
  }
});

test("E11 an org admin's re-enable doesn't lift a suspension; lifting it does", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e11");
  const max = await actor(request, "e11-max");
  await addToCompany(request, acme, max);
  await setMemberEnabled(request, acme, max, false);
  await setSuspended(request, acme.sys, max, true);
  await prep(page);

  await test.step("both switches on: record which message shows", async () => {
    await submitLogin(page, max.email, max.password);
    await expect(loginError(page), "a refusal should show").toBeVisible();
    note(testInfo, "open", `With both switches on, the login page says: "${await loginError(page).innerText()}"`);
  });

  await test.step("Olive re-enables him; still suspended", async () => {
    await setMemberEnabled(request, acme, max, true);
    await submitLogin(page, max.email, max.password);
    await expect(page.getByText(SUSPENDED_COPY, { exact: true }), "after the re-enable he should still see the suspended copy").toBeVisible();
    await expectOnLoginSignedOut(page, "re-enabled but suspended");
    await shot(page, testInfo, "E11-01-still-suspended");
  });

  await test.step("the operator unsuspends him; he signs in", async () => {
    await setSuspended(request, acme.sys, max, false);
    await signInOnForm(page, max);
    await shot(page, testInfo, "E11-02-unsuspended-signed-in");
  });
});

test("E12 other login refusals are unchanged", async ({ page, request }, testInfo) => {
  const gus = await actor(request, "e12-gus");
  await prep(page);
  let wrong = "";

  await test.step("a wrong password", async () => {
    await submitLogin(page, gus.email, "wrong-password-999");
    await expect(loginError(page), "a wrong password should show a message").toBeVisible();
    wrong = (await loginError(page).innerText()).trim();
    expect(wrong, "the message should not be blank").not.toBe("");
    note(testInfo, "observed", `Wrong password: "${wrong}"`);
    await expectNoRawCode(page, "wrong password");
    await expectOnLoginSignedOut(page, "wrong password");
    await shot(page, testInfo, "E12-01-wrong-password");
  });

  await test.step("an unknown email", async () => {
    await submitLogin(page, `e2e-org-core-nobody-${RUN}@test.local`, "wrong-password-999");
    await expect(loginError(page), "an unknown email should show a message").toBeVisible();
    expect((await loginError(page).innerText()).trim(), "the unknown-email message should match the wrong-password one").toBe(wrong);
    await expectNoRawCode(page, "unknown email");
    await expectOnLoginSignedOut(page, "unknown email");
    await shot(page, testInfo, "E12-02-unknown-email");
  });

  await test.step("an unverified account's correct password", async () => {
    const email = `e2e-org-core-e12-unverified-${RUN}-${++seq}@test.local`;
    const password = "e2e-password-123";
    const reg = await request.post(`${BACKEND_URL}/auth/register`, { data: { email, password, tosAccepted: true } });
    expect(reg.ok(), "fixture: the unverified account should register").toBe(true);
    await submitLogin(page, email, password);
    await page.waitForLoadState("networkidle");
    await expect(page, "an unverified account should not reach the dashboard").not.toHaveURL(/\/app\/dashboard/);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const resend = await page.getByRole("button", { name: /resend/i }).count();
    note(testInfo, "open", `Unverified account: URL ${page.url()}; token stored: ${(await sessionToken(page)) !== null}; resend controls: ${resend}; text: "${text.slice(0, 400)}"`);
    await expectNoRawCode(page, "unverified account");
    expect(text, "the page should not show a broken value").not.toMatch(BROKEN_VALUE);
    await shot(page, testInfo, "E12-03-unverified");
  });
});

// ── Mid-session refusals

test("E13 a disabled member's signed-in tab signs out @mobile", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e13");
  const max = await actor(request, "e13-max");
  await addToCompany(request, acme, max);
  await prep(page);

  await test.step("Max is signed in on the dashboard", async () => {
    await signInOnForm(page, max);
    await shot(page, testInfo, "E13-01-signed-in-before");
  });

  await test.step("Olive disables him; he navigates client-side", async () => {
    await markWindow(page);
    await setMemberEnabled(request, acme, max, false);
    await recordCachedNav(page, testInfo);
    await clientNav(page, testInfo, "Settings");
    await expectOnLoginSignedOut(page, "after client-side navigation");
    expect(await windowMarked(page), "the sign-out should happen without a page load").toBe(true);
    await expectNoRawCode(page, "after client-side navigation");
    await expect(page.getByRole("navigation", { name: "Main navigation" }), "no half-rendered shell should remain").toHaveCount(0);
    const explained = await page.getByText(DISABLED_COPY).count();
    note(testInfo, "open", `At the moment of sign-out the login page ${explained ? "shows the disabled copy" : "gives no explanation; it is the plain login form"} (URL ${page.url()}).`);
    await shot(page, testInfo, "E13-02-signed-out-after-navigation");
  });

  await test.step("going back to an app URL keeps him out", async () => {
    await page.goBack();
    await expect(page, "browser back should keep him out").toHaveURL(/\/auth\/login/);
    await page.goto("/app/dashboard");
    await expect(page, "typing an app URL should keep him out").toHaveURL(/\/auth\/login/);
    expect(await sessionToken(page), "the token should stay gone").toBeNull();
  });

  await test.step("signing in there shows the disabled copy", async () => {
    await page.locator("#email").fill(max.email);
    await page.locator("#password").fill(max.password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText(DISABLED_COPY, { exact: true }), "signing in should show the disabled copy").toBeVisible();
    await shot(page, testInfo, "E13-04-signin-after-signout");
  });

  await test.step("the same again, with a full reload as the trigger", async () => {
    await setMemberEnabled(request, acme, max, true);
    await signInOnForm(page, max);
    await setMemberEnabled(request, acme, max, false);
    await page.reload();
    await expectOnLoginSignedOut(page, "after a full reload");
    await expectNoRawCode(page, "after a full reload");
    const explained = await page.getByText(DISABLED_COPY).count();
    note(testInfo, "open", `After the reload trigger the login page ${explained ? "shows the disabled copy" : "gives no explanation"} (URL ${page.url()}).`);
    await shot(page, testInfo, "E13-03-signed-out-after-reload");
    await page.goto("/app/keys");
    await expect(page, "typing an app URL should keep him out after the reload too").toHaveURL(/\/auth\/login/);
  });
});

test("E14 a suspended account's signed-in tab signs out", async ({ page, request }, testInfo) => {
  const sys = await operator(request, "e14");
  const gus = await actor(request, "e14-gus");
  await prep(page);
  await signInOnForm(page, gus);

  await test.step("the operator suspends him; he navigates client-side", async () => {
    await setSuspended(request, sys, gus, true);
    await clientNav(page, testInfo, "Settings");
    await expectOnLoginSignedOut(page, "suspended tab");
    await expectNoRawCode(page, "suspended tab");
    await shot(page, testInfo, "E14-01-suspended-signed-out");
  });

  await test.step("signing in shows the suspended copy", async () => {
    await submitLogin(page, gus.email, gus.password);
    await expect(page.getByText(SUSPENDED_COPY, { exact: true }), "signing in should show the suspended copy").toBeVisible();
  });
});

test("E15 a session that made no request while disabled survives re-enabling", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e15");
  const max = await actor(request, "e15-max");
  await addToCompany(request, acme, max);
  await prep(page);
  await signInOnForm(page, max);
  const before = await sessionToken(page);
  const windowRequests: string[] = [];

  await test.step("Olive disables and re-enables him while the tab is idle", async () => {
    const onRequest = (r: { url(): string; method(): string }) => {
      if (r.url().startsWith(BACKEND_URL)) windowRequests.push(`${r.method()} ${r.url().slice(BACKEND_URL.length)}`);
    };
    page.on("request", onRequest);
    await setMemberEnabled(request, acme, max, false);
    await page.waitForTimeout(12_000);
    await setMemberEnabled(request, acme, max, true);
    page.off("request", onRequest);
    note(testInfo, "observed", `Requests from the tab during the 12-second disabled window: ${windowRequests.length ? windowRequests.join(", ") : "none"}.`);
  });

  await test.step("he navigates in that tab", async () => {
    const [answered] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/auth/me") && r.request().method() === "GET"),
      clientNav(page, testInfo, "Settings"),
    ]);
    expect(answered.status(), "the first request after the re-enable should succeed with the same session").toBe(200);
    await expect(page, `he should still be signed in; requests during the window: ${windowRequests.join(", ") || "none"}`).toHaveURL(/\/app\/settings\/account/);
    await page.waitForLoadState("networkidle");
    expect(await sessionToken(page), "the session should be the same, with no new login").toBe(before);
    await expect(page.getByText(max.email), "the page should render with his email").toBeVisible();
    await shot(page, testInfo, "E15-01-same-session-after-reenable");
  });
});

test("E16 an ordinary 403 doesn't sign anyone out", async ({ page, request }, testInfo) => {
  const gus = await actor(request, "e16-gus");
  const other = await actor(request, "e16-other");
  const otherBook = (await booksOf(request, other))[0]!;
  await prep(page);
  await signInOnForm(page, gus);
  const statuses: string[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith(BACKEND_URL) && r.url().includes(otherBook.id)) statuses.push(`${r.status()} ${r.url().slice(BACKEND_URL.length)}`);
  });

  await test.step("he opens a book he isn't a member of", async () => {
    await page.goto(`/app/recipe-books/${otherBook.id}/traces`);
    await page.waitForLoadState("networkidle");
    note(testInfo, "observed", `Responses for the other person's book: ${statuses.join(", ")}.`);
    expect(statuses.some((s) => s.startsWith("403")), "the backend should answer an ordinary 403 here").toBe(true);
  });

  await test.step("he stays signed in, and an error appears", async () => {
    await expect(page, "an ordinary 403 should not bounce him to login").toHaveURL(new RegExp(`/app/recipe-books/${otherBook.id}/traces`));
    expect(await sessionToken(page), "an ordinary 403 should leave the session in place").not.toBeNull();
    const main = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
    note(testInfo, "observed", `Page text: "${main.slice(0, 160)}"`);
    await expect(page.getByRole("main").getByText(/Not a member|Forbidden|Failed to load/), "an error should appear on the page").toBeVisible();
    await shot(page, testInfo, "E16-01-ordinary-403-stays-signed-in");
  });

  await test.step("the session still works", async () => {
    await clientNav(page, testInfo, "API Keys");
    await expect(page, "he should still be able to navigate").toHaveURL(/\/app\/keys/);
  });
});

test("E17 a session from before the account's cut-off", async ({ page, request }, testInfo) => {
  const gus = await actor(request, "e17-gus");
  await prep(page);
  await signInOnForm(page, gus);
  const token = (await sessionToken(page))!;
  const iat = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).iat as number;
  const cutOff = iat + 3;

  await test.step("the cut-off is stamped ahead of the session; he navigates", async () => {
    await stampSessionCutOff(gus.email, cutOff);
    await clientNav(page, testInfo, "Settings");
    await expectOnLoginSignedOut(page, "expired session");
    await expectNoRawCode(page, "expired session");
    note(testInfo, "observed", `Login page after the expired session: URL ${page.url()}; "This session has ended" shown: ${await page.getByText("This session has ended").count() > 0}.`);
    await shot(page, testInfo, "E17-01-expired-session-signed-out");
  });

  await test.step("a new sign-in reaches the dashboard and survives a reload", async () => {
    await page.waitForTimeout(Math.max(0, (cutOff + 1) * 1000 - Date.now()));
    await signInOnForm(page, gus);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page, "the new session should stay on the dashboard through a reload").toHaveURL(/\/app\/dashboard/);
    expect(await sessionToken(page), "the new session should still be stored").not.toBeNull();
    await shot(page, testInfo, "E17-02-new-session-works");
  });
});

// ── Self-deletion

test("E18 a managed account's self-deletion is refused in Settings @mobile", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e18");
  const max = await actor(request, "e18-max");
  await addToCompany(request, acme, max);
  await prep(page);
  await signInOnForm(page, max);

  await test.step("the delete flow with the correct password", async () => {
    await page.goto("/app/settings/account");
    await page.waitForLoadState("networkidle");
    const section = (await page.locator(".card").filter({ hasText: "Delete account" }).innerText()).replace(/\s+/g, " ");
    note(testInfo, "open", /organi[sz]ation|admin of|managed/i.test(section.replace(/longest-standing admin/g, "")) ? `The page warns before the attempt: "${section}"` : `The page gives no warning before the attempt that a managed account can't delete itself. Section text: "${section}"`);
    await startDelete(page, max.password);
    const refusal = page.getByText(MANAGED_DELETE_COPY, { exact: true });
    await expect(refusal, "the managed copy should show, verbatim").toBeVisible();
    await expect(refusal, "the refusal should be where the person is looking, not off-screen").toBeInViewport();
    await expectNoRawCode(page, "delete refused", false);
    expect(await sessionToken(page), "he should stay signed in").not.toBeNull();
    await shot(page, testInfo, "E18-01-delete-refused-managed", false);
  });

  await test.step("reload, then another page", async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page, "reloading should leave him on Settings").toHaveURL(/\/app\/settings\/account/);
    await expect(page.getByText(max.email), "the account should still be intact").toBeVisible();
    await shot(page, testInfo, "E18-02-after-reload-still-signed-in");
    await clientNav(page, testInfo, "Recipe Books");
    await expect(page, "another page should open").toHaveURL(/\/app\/recipe-books/);
    await expect(page.getByRole("heading", { name: "Recipe Books", level: 1 }), "the page should render").toBeVisible();
    expect((await me(request, max.token)).status, "the account should still work").toBe(200);
  });

  await test.step("the wrong-password case", async () => {
    await page.goto("/app/settings/account");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Delete my account/ }).click();
    await page.locator("#delete-confirm-password").fill("wrong-password-999");
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/auth/me") && r.request().method() === "DELETE"),
      page.getByRole("button", { name: "Permanently delete" }).click(),
    ]);
    await page.waitForTimeout(800);
    const token = await sessionToken(page);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    note(testInfo, "open", `Wrong password in the delete form: HTTP ${resp.status()}; URL afterwards ${page.url()}; signed in afterwards: ${token !== null}; "incorrect password" on the page: ${/incorrect password/i.test(text)}.`);
    await shot(page, testInfo, "E18-03-wrong-password");
  });
});

test("E19 an owner's self-deletion is refused too", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e19");
  await prep(page);
  await signInOnForm(page, acme.olive);

  await test.step("the delete flow with the correct password", async () => {
    await page.goto("/app/settings/account");
    await page.waitForLoadState("networkidle");
    await startDelete(page, acme.olive.password);
    await expect(page.getByText(MANAGED_DELETE_COPY, { exact: true }), "the managed copy should show for an owner too").toBeVisible();
    await shot(page, testInfo, "E19-01-delete-refused-owner");
  });

  await test.step("the organization is intact", async () => {
    const m = await me(request, acme.olive.token);
    expect(m.body.data.user.organization?.id, "Olive should still be in the organization").toBe(acme.orgId);
    expect(m.body.data.user.organization?.role, "Olive should still be its owner").toBe("owner");
    expect((await booksOf(request, acme.olive)).map((b) => b.id), "the default book should still be listed").toContain(acme.defaultBookId);
  });
});

test("E20 an ordinary account deletes itself", async ({ page, request }, testInfo) => {
  const throwaway = await actor(request, "e20-throwaway");
  await prep(page);
  await signInOnForm(page, throwaway);

  await test.step("delete it through Settings", async () => {
    await page.goto("/app/settings/account");
    await page.waitForLoadState("networkidle");
    await startDelete(page, throwaway.password);
    await expectOnLoginSignedOut(page, "after deletion");
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    note(testInfo, "observed", `After deletion: URL ${page.url()}; deleted notice: ${/deleted/i.test(text)}.`);
    await expect(page.getByText(/deleted/i), "the login page should confirm the deletion").toBeVisible();
    await shot(page, testInfo, "E20-01-delete-ordinary-success");
  });

  await test.step("it can't sign in afterwards", async () => {
    await submitLogin(page, throwaway.email, throwaway.password);
    await expect(loginError(page), "a refusal should show").toBeVisible();
    await expectOnLoginSignedOut(page, "signing in after deletion");
    note(testInfo, "observed", `Sign-in after deletion says: "${await loginError(page).innerText()}"`);
    await shot(page, testInfo, "E20-02-cant-sign-in-after");
  });
});

// ── Books and joining

test("E21 a managed account's new book lands in the company @mobile", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e21");
  const max = await actor(request, "e21-max");
  const gus = await actor(request, "e21-gus");
  const gusBook = await createBookByApi(request, gus, unique("gus-shared"));
  await addToCompany(request, acme, max);
  await shareBook(request, gus, gusBook.id, max);
  const listed = await booksOf(request, max);
  note(testInfo, "observed", `Max's list order: ${listed.map((b) => `${b.name} (${b.member_role})`).join("; ")}.`);
  await signIn(page, max, "/app/recipe-books");
  const name = unique("Max notes");

  await test.step("create a book on the Recipe Books page", async () => {
    const resp = await createBookInUi(page, name);
    expect(resp.status(), "creating the book should succeed").toBe(201);
    await expect(bookCard(page, name), "the new book should be listed").toBeVisible();
    await expect(page.getByRole("main").getByText(/Organization not found|not yours/), "no error should show").toHaveCount(0);
    await shot(page, testInfo, "E21-01-managed-book-created");
  });

  await test.step("reload; read its organization back", async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(bookCard(page, name), "the new book should be listed after a reload").toBeVisible();
    const book = (await booksOf(request, max)).find((b) => b.name === name)!;
    expect(book.organization_id, "the new book should belong to Acme").toBe(acme.orgId);
    await shot(page, testInfo, "E21-02-after-reload");
  });
});

test("E22 a guest of a company book creates a book for themselves", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e22");
  const gus = await actor(request, "e22-gus");
  const personalOrg = (await booksOf(request, gus))[0]!.organization_id;
  const acmeBook = await createBookByApi(request, acme.olive, unique("acme-guests"));
  await shareBook(request, acme.olive, acmeBook.id, gus);
  const listed = await booksOf(request, gus);
  note(testInfo, "observed", `Gus's list order: ${listed.map((b) => `${b.name} (${b.member_role})`).join("; ")}; the Acme book is ${listed[0]!.id === acmeBook.id ? "at the top" : "not at the top"}.`);
  await signIn(page, gus, "/app/recipe-books");
  const name = unique("Gus own");

  await test.step("create a book through the SPA", async () => {
    const resp = await createBookInUi(page, name);
    expect(resp.status(), "creating the book should succeed").toBe(201);
    await expect(bookCard(page, name), "the new book should be listed").toBeVisible();
    await shot(page, testInfo, "E22-01-guest-book-created");
  });

  await test.step("reload; it is in his personal organization", async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(bookCard(page, name), "the new book should be listed after a reload").toBeVisible();
    const book = (await booksOf(request, gus)).find((b) => b.name === name)!;
    expect(book.organization_id, "the new book should be in Gus's personal organization").toBe(personalOrg);
    await shot(page, testInfo, "E22-02-after-reload");
  });

  await test.step("open: an account with no shared books, and leaving every book", async () => {
    const plain = await actor(request, "e22-plain");
    const plainOrg = (await booksOf(request, plain))[0]!.organization_id;
    const { context, page: p } = await signInNewContext(page.context().browser()!, testInfo, plain, "/app/recipe-books");
    const plainName = unique("Plain own");
    const resp = await createBookInUi(p, plainName);
    const book = (await booksOf(request, plain)).find((b) => b.name === plainName);
    note(testInfo, "open", `Account with no shared books: creating a book answered ${resp.status()}, organization is personal: ${book?.organization_id === plainOrg}.`);
    await p.goto("/app/recipe-books");
    await p.waitForLoadState("networkidle");
    await p.getByRole("heading", { name: plainName, exact: true }).click();
    await p.waitForLoadState("networkidle");
    const controls = await p.getByRole("button", { name: /leave|delete/i }).count();
    note(testInfo, "open", `Leaving or deleting every book: the Recipe Books page offers ${controls} leave or delete control(s) on an owned, expanded book, so that state ${controls ? "may be reachable" : "can't be reached through the UI"}.`);
    await context.close();
  });
});

test("E23 the PR's manual steps 1 and 2, seen from the SPA", async ({ page, browser, request }, testInfo) => {
  const acme = await company(request, "e23");
  const max = await actor(request, "e23-max");
  const notes = await createBookByApi(request, max, unique("max-notes"));
  const personal = (await booksOf(request, max)).find((b) => b.id !== notes.id)!;
  const key = await mintByApi(request, max, 30, "e23-seed");
  const marker = `zqmoved${RUN}`;
  const qs = new URLSearchParams({
    key: key.key,
    recipe: `As a release planner working on the launch checklist (${marker}), I prefer small reviewed changes so that nothing ships unseen.`,
    evidence: `Asked the person.\n> "seed quote ${marker}"\n-- org-core.spec.ts`,
    format: "json",
    recipe_book: personal.slug,
  });
  const seeded = await request.get(`${BACKEND_URL}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
  expect(seeded.ok(), `fixture: seeding a recipe should succeed; got ${seeded.status()} ${(await seeded.text()).slice(0, 300)}`).toBe(true);
  expect((await booksOf(request, max)).map((b) => b.slug), "fixture: Max should hold a Personal book before joining").toContain("personal");
  let joined: Awaited<ReturnType<typeof addToCompany>>;

  await test.step("with Max on Recipe Books, the operator adds him; reload", async () => {
    await signIn(page, max, "/app/recipe-books");
    await page.waitForLoadState("networkidle");
    joined = await addToCompany(request, acme, max);
    note(testInfo, "observed", `Moved books: ${joined.movedBooks.map((b) => `${b.name}: ${b.previousSlug} -> ${b.slug}`).join("; ")}.`);
    await page.reload();
    await page.waitForLoadState("networkidle");
    const m = await me(request, max.token);
    expect(m.body.data.user.organization?.name, "/auth/me should name Acme").toBe(acme.orgName);
    expect(m.body.data.user.organization?.role, "/auth/me should give him the member role").toBe("member");
    await expect(page.getByRole("heading", { name: personal.name, exact: true }), "his Personal book should be there").toBeVisible();
    const after = (await booksOf(request, max));
    const movedPersonal = after.find((b) => b.id === personal.id)!;
    expect(movedPersonal.organization_id, "his Personal book should now belong to Acme").toBe(acme.orgId);
    const movedNotes = after.find((b) => b.id === notes.id)!;
    expect(movedNotes.slug, "a book whose slug is free in Acme should keep it").toBe(notes.slug);
    expect(movedPersonal.slug === "personal" || /^personal-/.test(movedPersonal.slug), "a slug changes only on a collision").toBe(true);
    const oliveBooks = await booksOf(request, acme.olive);
    note(testInfo, "observed", `Personal slug after joining: "${movedPersonal.slug}" (Olive's Personal moved first and holds ${oliveBooks.find((b) => b.slug === "personal") ? '"personal"' : "no such slug"}).`);
    const defaultListed = await page.getByRole("heading", { name: acme.orgName, exact: true }).count();
    const orgText = (await page.getByRole("main").innerText()).split(acme.orgName).length - 1;
    note(testInfo, "open", `Acme's default book on Max's page: ${defaultListed ? "listed" : "not listed"}. The organization's name appears ${orgText} time(s) on the page, only as that book's name if listed; there is no separate organization label unless the screenshot shows one.`);
    await shot(page, testInfo, "E23-01-books-after-join");
  });

  await test.step("open the moved book by its old link and by the page's link", async () => {
    const oldLink = `/app/recipe-books/${personal.id}/traces`;
    await page.goto(oldLink);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(new RegExp(marker)).first(), "the old link should open the book with its recipe").toBeVisible();
    await page.goto("/app/recipe-books");
    await page.waitForLoadState("networkidle");
    await bookCard(page, personal.name).getByRole("link", { name: /Review traces/ }).click();
    await expect(page, "the link the page shows should open the same book").toHaveURL(new RegExp(personal.id));
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(new RegExp(marker)).first(), "the page's link should show the recipe").toBeVisible();
    await shot(page, testInfo, "E23-02-moved-book-open");
    await page.goto(`/app/recipe-books?justJoined=personal`);
    await page.waitForLoadState("networkidle");
    const expanded = await page.getByText(/You're in the .* recipe book/).count();
    note(testInfo, "open", `The only slug-bearing SPA link is /app/recipe-books?justJoined=<slug>: with his old slug "personal" it ${expanded ? "still finds the book" : "finds nothing and shows the plain list, without an error"}. Book links use ids, so they don't change with the slug.`);
  });

  await test.step("a second joiner whose Personal book collides", async () => {
    const cy = await actor(request, "e23-cy");
    const cyPersonal = (await booksOf(request, cy))[0]!;
    await addToCompany(request, acme, cy);
    const moved = (await booksOf(request, cy)).find((b) => b.id === cyPersonal.id)!;
    expect(moved.slug, "a colliding slug should change").not.toBe("personal");
    const { context, page: p } = await signInNewContext(browser, testInfo, cy, "/app/recipe-books");
    await p.waitForLoadState("networkidle");
    await expect(p.getByText(`/${moved.slug}`), "the page should show the changed slug").toBeVisible();
    await bookCard(p, cyPersonal.name).getByRole("link", { name: /Review traces/ }).click();
    await expect(p, "the colliding book should open by the page's link").toHaveURL(new RegExp(cyPersonal.id));
    await p.waitForLoadState("networkidle");
    await expect(p.getByText(/Failed to load|Forbidden|Not a member/), "the colliding book should open without an error").toHaveCount(0);
    await p.goto("/app/recipe-books");
    await p.waitForLoadState("networkidle");
    await shot(p, testInfo, "E23-03-collision-slug");
    note(testInfo, "observed", `Second joiner's slug: "${moved.slug}".`);
    await context.close();
  });

  await test.step("the notice emails", async () => {
    const toMax = await mailTo(request, max.email, /joined/i);
    note(testInfo, "observed", `Max's email. Subject: "${toMax.Subject}". Text: ${toMax.Text.replace(/\s+/g, " ")}`);
    expect(toMax.Subject, "the subject should name the organization").toContain(acme.orgName);
    expect(toMax.Text, "the email should say he joined").toContain(`part of ${acme.orgName}`);
    expect(toMax.Text, "the email should say admins manage the account").toMatch(/admins manage this account/);
    expect(toMax.Text, "the email should name the moved Personal book").toContain(personal.name);
    expect(toMax.Text, "the email should name the other moved book").toContain(notes.name);
    const toOlive = await mailTo(request, acme.olive.email, /joined/i);
    note(testInfo, "observed", `Olive's email. Subject: "${toOlive.Subject}". Text: ${toOlive.Text.replace(/\s+/g, " ")}`);
    expect(toOlive.Text, "Olive's email should say she joined").toContain(`part of ${acme.orgName}`);
    expect(toOlive.Text, "Olive's email should say admins manage the account").toMatch(/admins manage this account/);
    const p = await page.context().newPage();
    await p.setContent(toMax.HTML);
    await shot(p, testInfo, "E23-04-notice-email");
    await p.close();
  });
});

test("E24 the PR's manual steps 3 and 4, end to end", async ({ page, request }, testInfo) => {
  const acme = await company(request, "e24");
  const max = await actor(request, "e24-max");
  await addToCompany(request, acme, max);
  await prep(page);
  await signInOnForm(page, max);
  let key = "";
  let listedBefore: Awaited<ReturnType<typeof keysOf>> = [];

  await test.step("Max mints a key on the API keys page", async () => {
    await openKeyForm(page);
    const resp = await submitKeyForm(page, "e24-agent", 30);
    expect(resp.status(), "the key should be minted").toBe(200);
    key = await rawKeyOnPage(page);
    expect((await callWithKey(request, key)).status, "the key should work before he is disabled").toBe(200);
    listedBefore = await keysOf(request, max);
  });

  await test.step("disabled: the key gets the same response an unknown key gets", async () => {
    await setMemberEnabled(request, acme, max, false);
    const unknown = `${key.slice(0, 8)}${"0".repeat(key.length - 8)}`;
    const dead = await callWithKey(request, key);
    const none = await callWithKey(request, unknown);
    note(testInfo, "observed", `/check: ${dead.status} ${dead.body.slice(0, 120)}`);
    expect(dead.status, "/check should refuse the disabled member's key").toBe(none.status);
    expect(dead.body, "/check's refusal should be byte for byte an unknown key's").toBe(none.body);
    const deadMcp = await mcpWithKey(request, key);
    const noneMcp = await mcpWithKey(request, unknown);
    note(testInfo, "observed", `/mcp: ${deadMcp.status} ${deadMcp.body.slice(0, 120)}`);
    expect(deadMcp.status, "/mcp should refuse the disabled member's key").toBe(noneMcp.status);
    expect(deadMcp.body, "/mcp's refusal should be byte for byte an unknown key's").toBe(noneMcp.body);
  });

  await test.step("re-enabled: the same key works", async () => {
    await setMemberEnabled(request, acme, max, true);
    expect((await callWithKey(request, key)).status, "the same key should work again").toBe(200);
    expect((await mcpWithKey(request, key)).status, "the same key should work on /mcp again").toBe(200);
  });

  await test.step("sign in; the same key is listed", async () => {
    await page.evaluate(() => localStorage.removeItem("claimnet_token"));
    await signInOnForm(page, max);
    await page.goto("/app/keys");
    await page.waitForLoadState("networkidle");
    const listedAfter = await keysOf(request, max);
    expect(listedAfter.map((k) => k.id), "it should be the same row in the keys list, with nothing re-minted").toEqual(listedBefore.map((k) => k.id));
    await expect(keyRow(page, "e24-agent"), "the key should be listed on the page").toBeVisible();
    await expect(page.getByText(`${listedBefore[0]!.keyPrefix}...`), "the page should show the same key prefix").toBeVisible();
    await shot(page, testInfo, "E24-01-same-key-listed-after-reenable");
  });
});

// ── Ordinary person unaffected, and whole-page checks

test("E25 the ordinary person's main flows @mobile", async ({ page, request }, testInfo) => {
  const gus = await actor(request, "e25-gus");
  await prep(page);
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith(BACKEND_URL) && r.status() >= 400) failures.push(`${r.status()} ${r.request().method()} ${r.url().slice(BACKEND_URL.length)}`);
  });
  const checkPage = async (what: string) => {
    const text = await page.locator("body").innerText();
    expect.soft(text, `${what}: no undefined or blank-derived value should show`).not.toMatch(BROKEN_VALUE);
    expect.soft(text, `${what}: no organization or managed wording should show`).not.toMatch(ORG_WORDING);
    await expect.soft(page.getByRole("alert"), `${what}: no error banner should show`).toHaveCount(0);
  };

  await test.step("real login form, dashboard", async () => {
    await signInOnForm(page, gus);
    await checkPage("dashboard");
    await shot(page, testInfo, "E25-01-dashboard");
  });

  await test.step("Recipe Books: create and open one", async () => {
    const name = unique("Gus book");
    const resp = await createBookInUi(page, name);
    expect(resp.status(), "creating a book should succeed").toBe(201);
    await expect(bookCard(page, name), "the book should be listed").toBeVisible();
    await checkPage("recipe books");
    await shot(page, testInfo, "E25-02-recipe-books");
    await bookCard(page, name).getByRole("link", { name: /Review traces/ }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 }), "the book should open").toBeVisible();
    await checkPage("book page");
  });

  await test.step("API keys: mint and revoke", async () => {
    await openKeyForm(page);
    const resp = await submitKeyForm(page, "e25-key", 30);
    expect(resp.status(), "minting a key should succeed").toBe(200);
    await expectRowExpiry(page, "e25-key", 30);
    await checkPage("keys");
    await shot(page, testInfo, "E25-03-keys");
    await keyRow(page, "e25-key").locator("..").getByRole("button", { name: "Revoke" }).click();
    await expect(keyRow(page, "e25-key"), "the revoked key should leave the list").toHaveCount(0);
  });

  await test.step("Settings shows his email", async () => {
    await page.goto("/app/settings/account");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(gus.email), "Settings should show his email").toBeVisible();
    await expect(page.getByText(/^Role: \S+/), "Settings should show his role").toBeVisible();
    note(testInfo, "observed", `Settings role line: "${await page.getByText(/^Role: \S+/).innerText()}".`);
    await checkPage("settings");
    await shot(page, testInfo, "E25-04-settings");
  });

  await test.step("sign out and in", async () => {
    await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
    await expectOnLoginSignedOut(page, "after sign-out");
    await signInOnForm(page, gus);
  });

  expect.soft(failures, "no backend request in these flows should fail").toEqual([]);
});

test("E26 anything in the SPA that used a field /auth/me no longer returns", async ({ page, browser, request }, testInfo) => {
  const sys = await operator(request, "e26");
  const gus = await actor(request, "e26-gus");
  const adminPages = ["/admin", "/admin/queues", "/admin/workers/embeddings", "/admin/users", "/admin/signups", "/admin/emails"];
  const DENIED = /You don't have access to this page/;
  const consumers = [
    "AppShell: role (Admin link)",
    "useAdminGate, AdminLandingPage, AdminEmbeddingsPage, AdminQueuesPage: role",
    "ApiKeysPage: organization",
    "SettingsAccountPage: email, role",
    "SettingsBriefingsPage: premium",
    "VerifyPendingPage: email, emailVerified",
  ];
  note(testInfo, "observed", `SPA consumers of the current user's fields: ${consumers.join(" | ")}.`);

  await test.step("the field list /auth/me returns", async () => {
    const m = await me(request, gus.token);
    const fields = Object.keys(m.body.data.user).sort();
    note(testInfo, "observed", `/auth/me user fields: ${fields.join(", ")}.`);
    expect(fields, "/auth/me should return the explicit field list").toEqual(["email", "emailVerified", "id", "organization", "premium", "role"]);
  });

  await test.step("Sys opens the operator's pages", async () => {
    await signIn(page, sys, "/admin");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Admin" }), "the Admin link should appear for the operator").toBeVisible();
    await expect(page.getByText(DENIED), "the operator should not be refused").toHaveCount(0);
    await shot(page, testInfo, "E26-01-admin-page-for-sys");
    for (const path of adminPages) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect.soft(page.getByText(DENIED), `${path} should open for the operator`).toHaveCount(0);
      expect.soft(await page.locator("body").innerText(), `${path} should show no broken value for the operator`).not.toMatch(BROKEN_VALUE);
    }
  });

  await test.step("Gus is refused the operator's pages and sees no Admin link", async () => {
    const { context, page: p } = await signInNewContext(browser, testInfo, gus, "/app/dashboard");
    await p.waitForLoadState("networkidle");
    await expect(p.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Admin" }), "no Admin link for an ordinary account").toHaveCount(0);
    for (const path of adminPages) {
      await p.goto(path);
      await p.waitForLoadState("networkidle");
      await expect.soft(p.getByText(DENIED), `${path} should be refused for an ordinary account`).toBeVisible();
    }
    for (const path of ["/app/dashboard", "/app/keys", "/app/settings/account", "/app/settings/briefings", "/app/recipe-books"]) {
      await p.goto(path);
      await p.waitForLoadState("networkidle");
      expect.soft(await p.locator("body").innerText(), `${path} should show no broken value`).not.toMatch(BROKEN_VALUE);
    }
    await p.goto("/app/settings/briefings");
    await p.waitForLoadState("networkidle");
    note(testInfo, "observed", `Premium card for a non-premium account: ${await p.getByText(/Premium features/).count()} on the page.`);
    await context.close();
  });

  await test.step("the verify-pending page reads email and emailVerified", async () => {
    const email = `e2e-org-core-e26-unverified-${RUN}-${++seq}@test.local`;
    const password = "e2e-password-123";
    const reg = await request.post(`${BACKEND_URL}/auth/register`, { data: { email, password, tosAccepted: true } });
    expect(reg.ok(), "fixture: the unverified account should register").toBe(true);
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const p = await context.newPage();
    await prep(p);
    await submitLogin(p, email, password);
    await expect(p, "an unverified account should land on verify-pending").toHaveURL(/verify-pending/);
    await p.waitForLoadState("networkidle");
    await expect(p.getByText(email).first(), "verify-pending should show the email").toBeVisible();
    expect(await p.locator("body").innerText(), "verify-pending should show no broken value").not.toMatch(BROKEN_VALUE);
    await context.close();
  });

  note(testInfo, "open", "A premium account: PUT /admin/users/:id/premium is not on the expectations' allowed fixture list, so the premium branch of SettingsBriefingsPage did not run (unverified).");
});

/** Every touched page and state from E27 and E28; `visit` runs at each. */
async function walkStates(
  page: Page,
  browser: Browser,
  request: APIRequestContext,
  testInfo: TestInfo,
  label: string,
  visit: (p: Page, state: string, message?: string) => Promise<void>,
) {
  const acme = await company(request, label);
  const max = await actor(request, `${label}-max`);
  const gus = await actor(request, `${label}-gus`);
  await addToCompany(request, acme, max);

  const ordinary = await signInNewContext(browser, testInfo, gus, "/app/keys");
  await openKeyForm(ordinary.page);
  await visit(ordinary.page, "keys-ordinary");
  await ordinary.page.goto("/app/recipe-books");
  await ordinary.page.waitForLoadState("networkidle");
  await visit(ordinary.page, "recipe-books-ordinary");
  await ordinary.context.close();

  const managed = await signInNewContext(browser, testInfo, max, "/app/keys");
  await openKeyForm(managed.page);
  await visit(managed.page, "keys-managed");
  await submitKeyForm(managed.page, `${label}-toolong`, 120);
  await expect(managed.page.getByText(/at most 90 days/), "the over-limit refusal should show").toBeVisible();
  await visit(managed.page, "keys-managed-refused", "Keys for an organization's accounts can last at most 90 days. Choose an expiry within 90 days.");
  await managed.page.goto("/app/recipe-books");
  await managed.page.waitForLoadState("networkidle");
  await visit(managed.page, "recipe-books-managed");
  await managed.page.goto("/app/settings/account");
  await managed.page.waitForLoadState("networkidle");
  await startDelete(managed.page, max.password);
  await expect(managed.page.getByText(MANAGED_DELETE_COPY, { exact: true }), "the delete refusal should show").toBeVisible();
  await visit(managed.page, "settings-refused", MANAGED_DELETE_COPY);
  await managed.context.close();

  await prep(page);
  await submitLogin(page, gus.email, "wrong-password-999");
  await expect(loginError(page), "the wrong-password message should show").toBeVisible();
  await visit(page, "login-wrong-password");
  await setMemberEnabled(request, acme, max, false);
  await submitLogin(page, max.email, max.password);
  await expect(page.getByText(DISABLED_COPY, { exact: true }), "the disabled copy should show").toBeVisible();
  await visit(page, "login-disabled", DISABLED_COPY);
  await setSuspended(request, acme.sys, gus, true);
  await submitLogin(page, gus.email, gus.password);
  await expect(page.getByText(SUSPENDED_COPY, { exact: true }), "the suspended copy should show").toBeVisible();
  await visit(page, "login-suspended", SUSPENDED_COPY);
}

test("E27 axe, on every touched page and state @mobile", async ({ page, browser, request }, testInfo) => {
  await walkStates(page, browser, request, testInfo, "e27", async (p, state) => {
    await test.step(`axe: ${state}`, async () => {
      // The submit button fades back after a pending state; judge settled colours.
      await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      const f = await axeFindings(p, testInfo, `E27-${state}`);
      if (f.moderate.length) note(testInfo, "observed", `${state}, moderate: ${f.moderate.join(" | ")}`);
      if (f.minor.length) note(testInfo, "observed", `${state}, minor: ${f.minor.join(" | ")}`);
      if (f.blocking.length) note(testInfo, "finding", `${state}, serious or critical: ${f.blocking.join(" | ")}`);
      expect.soft(f.blocking, `${state}: axe should find no serious or critical violation`).toEqual([]);
    });
  });
});

test("E28 overflow, on every touched page and state @mobile", async ({ page, browser, request }, testInfo) => {
  const fixedShots: Record<string, string> = {
    "login-disabled": "E28-01-mobile-login-disabled",
    "settings-refused": "E28-02-mobile-settings-refused",
    "keys-managed": "E28-03-mobile-keys-managed",
  };
  await walkStates(page, browser, request, testInfo, "e28", async (p, state, message) => {
    await test.step(`overflow: ${state}`, async () => {
      const m = await assertNoHorizontalScroll(p, testInfo, `E28-${state}`);
      note(testInfo, "observed", `${state}: content ${m.contentWidth}px on a ${m.deviceWidth}px device.`);
      if (message) {
        const el = p.getByText(message, { exact: true });
        await el.scrollIntoViewIfNeeded();
        const box = (await el.boundingBox())!;
        expect.soft(box.x, `${state}: the message should start inside the screen`).toBeGreaterThanOrEqual(0);
        expect.soft(box.x + box.width, `${state}: the message should end inside the screen`).toBeLessThanOrEqual(m.deviceWidth);
      }
      if (isPhone(testInfo) && fixedShots[state]) await shot(p, testInfo, fixedShots[state]!, false);
    });
  });
});

async function tabTo(page: Page, matches: RegExp): Promise<{ presses: number; label: string }> {
  for (let i = 1; i <= 80; i++) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return `${el?.id ? `#${el.id} ` : ""}${el?.innerText ?? ""}`.trim();
    });
    if (matches.test(label)) return { presses: i, label };
  }
  throw new Error(`Tab never reached ${matches}`);
}

async function focusShows(page: Page) {
  await page.waitForTimeout(300); // the design system's focus ring fades in
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return {
      tag: el.tagName,
      focusVisible: el.matches(":focus-visible"),
      outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
      boxShadow: s.boxShadow,
      border: s.borderColor,
      shown: (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && !s.boxShadow.startsWith("rgba(0, 0, 0, 0)")),
    };
  });
}

async function announcement(locator: Locator) {
  return locator.evaluate((el) => {
    const a = el.closest("[role=alert],[role=status],[aria-live]");
    return a ? `${a.getAttribute("role") ?? ""} ${a.getAttribute("aria-live") ?? ""}`.trim() : "no live region or alert role";
  });
}

test("E29 keyboard-only on the changed controls", async ({ page, browser, request }, testInfo) => {
  const acme = await company(request, "e29");
  const max = await actor(request, "e29-max");
  await addToCompany(request, acme, max);

  await test.step("sign in and reach the refusal", async () => {
    await setMemberEnabled(request, acme, max, false);
    await prep(page);
    await page.goto("/auth/login");
    const onEmail = await page.evaluate(() => document.activeElement?.id);
    note(testInfo, "observed", `Login: focus on load is on "#${onEmail}".`);
    if (onEmail !== "email") await tabTo(page, /#email/);
    await page.keyboard.type(max.email);
    const emailFocus = await focusShows(page);
    await page.keyboard.press("Tab");
    await page.keyboard.type(max.password);
    const pwFocus = await focusShows(page);
    expect.soft(emailFocus.focusVisible && emailFocus.shown, `the email field should show focus: ${JSON.stringify(emailFocus)}`).toBe(true);
    expect.soft(pwFocus.focusVisible && pwFocus.shown, `the password field should show focus: ${JSON.stringify(pwFocus)}`).toBe(true);
    note(testInfo, "observed", `Login focus: email ${JSON.stringify(emailFocus)}; password ${JSON.stringify(pwFocus)}.`);
    await page.keyboard.press("Enter");
    const refusal = page.getByText(DISABLED_COPY, { exact: true });
    await expect(refusal, "the refusal should be reachable with the keyboard alone").toBeVisible();
    note(testInfo, "open", `Login refusal announcement: ${await announcement(refusal)}.`);
    const onSubmit = await tabTo(page, /Sign In|Forgot|#email|#password/);
    note(testInfo, "observed", `After the refusal, Tab reaches "${onSubmit.label}" in ${onSubmit.presses} press(es); ${JSON.stringify(await focusShows(page))}.`);
    await shot(page, testInfo, "E29-01-keyboard-refusal");
    await setMemberEnabled(request, acme, max, true);
  });

  const { context, page: p } = await signInNewContext(browser, testInfo, max, "/app/keys");
  await p.waitForLoadState("networkidle");

  await test.step("mint a key as Max with the keyboard", async () => {
    const create = await tabTo(p, /Create Key/);
    const createFocus = await focusShows(p);
    expect.soft(createFocus.focusVisible && createFocus.shown, `Create Key should show focus: ${JSON.stringify(createFocus)}`).toBe(true);
    await p.keyboard.press("Enter");
    await expect(p.locator("#scopedDays"), "Enter on Create Key should open the form").toBeVisible();
    const days = await tabTo(p, /#scopedDays/);
    const daysFocus = await focusShows(p);
    expect.soft(daysFocus.focusVisible && daysFocus.shown, `the days field should show focus: ${JSON.stringify(daysFocus)}`).toBe(true);
    await p.keyboard.press("Control+A");
    await p.keyboard.type("45");
    const generate = await tabTo(p, /Generate Key/);
    const generateFocus = await focusShows(p);
    expect.soft(generateFocus.focusVisible && generateFocus.shown, `Generate Key should show focus: ${JSON.stringify(generateFocus)}`).toBe(true);
    await p.keyboard.press("Enter");
    await expect(p.getByText("Key shown once only"), "Enter on Generate Key should mint the key").toBeVisible();
    expect((await keysOf(request, max)).length, "one key should exist").toBe(1);
    note(testInfo, "observed", `Keyboard mint: Tab presses to Create Key ${create.presses}, then to the days field ${days.presses}, then to Generate Key ${generate.presses}. Days field focus: ${JSON.stringify(daysFocus)}.`);
  });

  await test.step("reach the delete refusal in Settings with the keyboard", async () => {
    await p.goto("/app/settings/account");
    await p.waitForLoadState("networkidle");
    await tabTo(p, /Delete my account/);
    const delFocus = await focusShows(p);
    expect.soft(delFocus.focusVisible && delFocus.shown, `Delete my account should show focus: ${JSON.stringify(delFocus)}`).toBe(true);
    await p.keyboard.press("Enter");
    const pw = await tabTo(p, /#delete-confirm-password/);
    await p.keyboard.type(max.password);
    const pd = await tabTo(p, /Permanently delete/);
    const pdFocus = await focusShows(p);
    expect.soft(pdFocus.focusVisible && pdFocus.shown, `Permanently delete should show focus: ${JSON.stringify(pdFocus)}`).toBe(true);
    await p.keyboard.press("Enter");
    const refusal = p.getByText(MANAGED_DELETE_COPY, { exact: true });
    await expect(refusal, "the delete refusal should be reachable with the keyboard alone").toBeVisible();
    await p.waitForTimeout(200);
    const after = await p.evaluate(() => document.activeElement?.tagName);
    note(testInfo, "open", `Delete refusal announcement: ${await announcement(refusal)}. Focus after the refusal is on ${after}. Tab presses to the password field ${pw.presses}, then to Permanently delete ${pd.presses}.`);
  });

  await context.close();
});

test("X1 a book name another member's book already uses is refused with a clear message", async ({ page, request }, testInfo) => {
  const acme = await company(request, "x1");
  const max = await actor(request, "x1-max");
  await addToCompany(request, acme, max);
  await signIn(page, max, "/app/recipe-books");

  await test.step("Olive's Personal book holds the slug in Acme; Max creates a book named Personal", async () => {
    const resp = await createBookInUi(page, "Personal");
    expect(resp.status(), "a slug taken in the organization should be refused as a conflict").toBe(409);
    await expect(page.getByRole("main").getByText(/Another recipe book in this organization already uses the short name "personal"/), "the page should say the short name is taken in this organization").toBeVisible();
    await expectNoRawCode(page, "slug taken in the company");
    await shot(page, testInfo, "X1-01-slug-taken-in-company");
  });

  await test.step("a different name creates the book", async () => {
    await page.getByPlaceholder("Recipe book name").fill(`Max notes ${RUN}`);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/recipe-books") && r.request().method() === "POST"),
      page.getByRole("main").getByRole("button", { name: "Create Recipe Book", exact: true }).click(),
    ]);
    expect(resp.status(), "a free name should create the book").toBe(201);
    await expect(bookCard(page, `Max notes ${RUN}`), "the new book should be listed").toBeVisible();
  });

  await test.step("control: an ordinary account repeats a slug of its own", async () => {
    const gus = await actor(request, "x1-gus");
    const { context, page: p } = await signInNewContext(page.context().browser()!, testInfo, gus, "/app/recipe-books");
    const resp = await createBookInUi(p, "Personal");
    expect(resp.status(), "a repeated slug should be refused as a conflict").toBe(409);
    await expect(p.getByRole("main").getByText(/You already have a recipe book with the short name "personal"/), "the page should point at the person's own book").toBeVisible();
    await context.close();
  });

  await test.step("a server failure with a non-JSON body shows a plain message", async () => {
    await page.route("**/recipe-books", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" }) : route.continue()));
    await page.getByRole("button", { name: "+ Create Recipe Book" }).click();
    await page.getByPlaceholder("Recipe book name").fill(`Another ${RUN}`);
    await page.getByRole("main").getByRole("button", { name: "Create Recipe Book", exact: true }).click();
    await expect(page.getByRole("main").getByText("Failed to create recipe book"), "a non-JSON failure should show the plain message").toBeVisible();
    await expect(page.getByRole("main").getByText(/Failed to execute|not valid JSON/), "no parser error should show").toHaveCount(0);
    await page.unroute("**/recipe-books");
  });
});
