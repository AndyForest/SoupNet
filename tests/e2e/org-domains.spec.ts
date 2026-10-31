import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import postgres from "postgres";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, type SeededUser } from "./helpers/accounts";
import { assertNoHorizontalScroll, axeFindings, shot } from "./helpers/evidence";

// Stream Domains: what /auth/verify says when an address joins a company
// organization on a captured domain, or can't for want of a seat. Regression
// test since #158's browser verification.
//
// Nia and Gus are registered over the API but NOT verified there: the browser
// does the verification by opening the link, which is what is under test.
// seedUser verifies over the API, so it seeds only owners and the operator.
//
// Two SQL writes, because neither has an API on a stack with NODE_ENV=production
// (the dev compose stack, where the .test DNS stub is off): making the seeded
// operator a site operator, and marking a domain claim as checked and found.
// Set E2E_PGDATABASE for a worktree stack's throwaway database.
//
// Accounts: owners and operators are e2e-*@test.local, which the cleanup script
// sweeps. Nia's address has to sit on the captured domain (e2e-*.test), so that
// script leaves those accounts behind.

const PASSWORD = "e2e-password-123";

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// ── fixture helpers ─────────────────────────────────────────────────────────

function dbSettings() {
  const env: Record<string, string | undefined> = { ...process.env };
  const file = join(__dirname, "..", "..", ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]!] ??= m[2]!.replace(/^["']|["']$/g, "");
    }
  }
  return {
    // 127.0.0.1, not the .env's localhost (a stale wslrelay can hold [::1]).
    host: "127.0.0.1",
    port: Number(env["PGPORT"] ?? 5633),
    user: env["PGUSER"]!,
    password: env["PGPASSWORD"]!,
    database: env["E2E_PGDATABASE"] ?? env["PGDATABASE"] ?? "claimnet",
  };
}

async function withDb<T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres({ ...dbSettings(), max: 1, onnotice: () => {} });
  try {
    return await work(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** A site operator seeded for this test. The role is read at login, so log in after setting it. */
async function operatorToken(request: APIRequestContext): Promise<string> {
  const operator = await seedUser(request, "operator");
  await withDb((sql) => sql`UPDATE claimnet.users SET role = 'system' WHERE email = ${operator.email}`);
  const res = await request.post(`${BACKEND_URL}/auth/login`, { data: { email: operator.email, password: operator.password } });
  const body = await res.json();
  expect(res.ok(), `the site operator should log in for fixture setup; got ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  return body.data.token as string;
}

interface CompanyFixture {
  organizationId: string;
  name: string;
  domain: string;
  owner: SeededUser;
  operator: string;
}

/** A company organization with a verified, auto-joining domain `e2e-<unique>.test`. */
async function companyWithCapturedDomain(request: APIRequestContext, label: string, seatLimit: number | null): Promise<CompanyFixture> {
  const operator = await operatorToken(request);
  const owner = await seedUser(request, `${label}-owner`);
  const id = unique();
  const name = `Kestrel Works ${id.slice(-4)}`;
  const slug = `kestrel-${id}`.toLowerCase();
  const domain = `e2e-${id}.test`.toLowerCase();

  const create = await request.post(`${BACKEND_URL}/admin/organizations`, {
    headers: { Authorization: `Bearer ${operator}` },
    data: { name, slug, ownerEmail: owner.email, seatLimit },
  });
  const createBody = await create.json();
  expect(create.status(), `creating the company organization should return 201; got ${JSON.stringify(createBody)}`).toBe(201);
  const organizationId = createBody.data.organizationId as string;

  const add = await request.post(`${BACKEND_URL}/organizations/${organizationId}/domains`, { headers: asUser(owner), data: { domain } });
  const addBody = await add.json();
  expect(add.ok(), `the owner should add the domain ${domain}; got ${add.status()} ${JSON.stringify(addBody)}`).toBe(true);
  const domainId = addBody.data.id as string;

  const verified = await withDb((sql) => sql`
    UPDATE claimnet.organization_domains
    SET verified_at = NOW(), last_checked_at = NOW(), last_found_at = NOW()
    WHERE id = ${domainId}::uuid
    RETURNING id
  `);
  expect(verified.length, `the fixture should mark ${domain} as verified`).toBe(1);

  const auto = await request.patch(`${BACKEND_URL}/organizations/${organizationId}/domains/${domainId}`, {
    headers: asUser(owner),
    data: { autoJoin: true },
  });
  const autoBody = await auto.json();
  expect(auto.ok(), `turning on automatic joining should succeed; got ${auto.status()} ${JSON.stringify(autoBody)}`).toBe(true);
  expect(autoBody.data.autoJoin, "the domain should now have automatic joining on").toBe(true);

  return { organizationId, name, domain, owner, operator };
}

/** Register an account and return its verification token, leaving it unverified. */
async function registerUnverified(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/auth/register`, { data: { email, password: PASSWORD, tosAccepted: true } });
  const body = await res.json();
  expect(res.ok(), `registering ${email} should succeed; got ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  expect(body.data?.verificationToken, "the test-mode backend should return a verification token").toBeTruthy();
  expect(body.data?.waitlisted, `${email} should not land on the waitlist`).toBe(false);
  return body.data.verificationToken as string;
}

async function setSeatLimit(request: APIRequestContext, company: CompanyFixture, seatLimit: number) {
  const res = await request.patch(`${BACKEND_URL}/admin/organizations/${company.organizationId}`, {
    headers: { Authorization: `Bearer ${company.operator}` },
    data: { seatLimit },
  });
  expect(res.ok(), `the site operator should set the seat limit to ${seatLimit}; got ${res.status()} ${await res.text()}`).toBe(true);
}

// ── page helpers ────────────────────────────────────────────────────────────

const verifyPath = (token: string) => `/auth/verify?token=${encodeURIComponent(token)}`;

/** Wait until the page leaves its loading state. */
async function settled(page: Page) {
  await expect(page.getByText("Verifying your email..."), "the verify page should finish loading").toHaveCount(0);
}

async function expectJoinedView(page: Page, email: string, orgName: string, what: string) {
  await expect(page.getByRole("heading", { name: "Email verified" }), `${what}: the page should show the "Email verified" success view`).toBeVisible();
  await expect(
    page.getByText(`${email} is now verified. You can sign in and start using Soup.net.`, { exact: true }),
    `${what}: the page should say the address is now verified`,
  ).toBeVisible();
  await expect(
    page.getByText(`Your account now belongs to ${orgName} on Soup.net. ${orgName}'s admins manage it.`, { exact: true }),
    `${what}: the page should say the account now belongs to ${orgName}`,
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In", exact: true }), `${what}: the page should offer a Sign In button`).toBeVisible();
}

async function recordAxe(page: Page, testInfo: TestInfo, name: string) {
  const f = await axeFindings(page, testInfo, name);
  const line = (impact: string, list: string[]) =>
    testInfo.annotations.push({ type: `axe-${impact}`, description: `${name} [${testInfo.project.name}]: ${list.length ? list.join(" | ") : "none"}` });
  line("blocking", f.blocking);
  line("moderate", f.moderate);
  line("minor", f.minor);
}

// ── tests ───────────────────────────────────────────────────────────────────

test("verifying an address on a captured domain says the account joined the organization @mobile", async ({ page, request }, testInfo) => {
  const company = await companyWithCapturedDomain(request, "joined", 5);
  const nia = `e2e-nia-${unique()}@${company.domain}`;
  const token = await registerUnverified(request, nia);

  await test.step("Nia opens the verification link", async () => {
    await page.goto(verifyPath(token));
    await settled(page);
    await expectJoinedView(page, nia, company.name, "first visit");
    await shot(page, testInfo, "joined-01-verified");
  });

  await test.step("axe scan and phone fit of the joined state", async () => {
    await recordAxe(page, testInfo, "joined-axe");
    await assertNoHorizontalScroll(page, testInfo, "joined view");
  });
});

test("verifying an ordinary address shows no organization line", async ({ page, request }, testInfo) => {
  const gus = `e2e-gus-${unique()}@test.local`;
  const token = await registerUnverified(request, gus);

  await test.step("Gus opens the verification link", async () => {
    await page.goto(verifyPath(token));
    await settled(page);
    await expect(page.getByRole("heading", { name: "Email verified" }), "an ordinary address should get the \"Email verified\" view").toBeVisible();
    await expect(
      page.getByText(`${gus} is now verified. You can sign in and start using Soup.net.`, { exact: true }),
      "the page should say Gus's address is now verified",
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In", exact: true }), "the page should offer a Sign In button").toBeVisible();
    await expect(page.getByText("belongs to"), "an ordinary verification should show no organization line").toHaveCount(0);
    await shot(page, testInfo, "ordinary-01-verified");
  });
});

test("at the seat limit the page says there are no free seats, and the address stays unverified @mobile", async ({ page, request }, testInfo) => {
  const company = await companyWithCapturedDomain(request, "full", 1);
  const nia = `e2e-nia-${unique()}@${company.domain}`;
  const token = await registerUnverified(request, nia);

  await test.step("Nia opens the verification link while the organization is full", async () => {
    await page.goto(verifyPath(token));
    await settled(page);
    await expect(page.getByRole("heading", { name: "No free seats" }), "a full organization should show the heading \"No free seats\"").toBeVisible();
    await expect(
      page.getByText("This organization has no free seats. Ask one of its admins.", { exact: true }),
      "the page should tell Nia the organization has no free seats and to ask its admins",
    ).toBeVisible();
    await expect(
      page.getByText("Your address isn't verified yet. This same link works for 24 hours once a seat is free, or sign in later to get a new one.", { exact: true }),
      "the page should say the address isn't verified yet and the same link will work once a seat is free",
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Email verified" }), "a full organization should not show the success view").toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign In", exact: true }), "a full organization should not offer the success view's Sign In button").toHaveCount(0);
    const back = page.getByRole("button", { name: "Back to sign in", exact: true });
    await expect(back, "the full view should offer a \"Back to sign in\" button").toBeVisible();
    await expect(
      page.locator("a", { has: back }),
      "the \"Back to sign in\" button should link to /auth/login",
    ).toHaveAttribute("href", /\/auth\/login$/);
    await shot(page, testInfo, "full-01-no-free-seats");
  });

  await test.step("Nia logs in over the API afterwards: no verified session", async () => {
    const res = await request.post(`${BACKEND_URL}/auth/login`, { data: { email: nia, password: PASSWORD } });
    const body = await res.json();
    expect(body.data?.emailVerified === true, "logging in after the refused join should not report a verified address").toBe(false);
    if (body.data?.token) {
      const books = await request.get(`${BACKEND_URL}/recipe-books`, { headers: { Authorization: `Bearer ${body.data.token}` } });
      expect(books.ok(), "an unverified session should be refused by a verified-only route").toBe(false);
    }
  });

  await test.step("axe scan and phone fit of the full state", async () => {
    await recordAxe(page, testInfo, "full-axe");
    await assertNoHorizontalScroll(page, testInfo, "no-free-seats view");
  });

  await test.step("Nia follows \"Back to sign in\"", async () => {
    await page.getByRole("button", { name: "Back to sign in", exact: true }).click();
    await expect(page, "\"Back to sign in\" should take Nia to the sign-in page").toHaveURL(/\/auth\/login(\?|$)/);
  });
});

test("once a seat frees, the same link joins", async ({ page, request }, testInfo) => {
  const company = await companyWithCapturedDomain(request, "freed", 1);
  const nia = `e2e-nia-${unique()}@${company.domain}`;
  const token = await registerUnverified(request, nia);

  await test.step("Nia opens the link while the organization is full", async () => {
    await page.goto(verifyPath(token));
    await settled(page);
    await expect(page.getByRole("heading", { name: "No free seats" }), "the full organization should first show \"No free seats\"").toBeVisible();
  });

  await test.step("the site operator raises the seat limit to 2", async () => {
    await setSeatLimit(request, company, 2);
  });

  await test.step("Nia reloads the same link", async () => {
    await page.reload();
    await settled(page);
    await expectJoinedView(page, nia, company.name, "after a seat frees");
    await shot(page, testInfo, "freed-01-joined");
  });
});

test("a bad token shows the existing error", async ({ page }, testInfo) => {
  await test.step("open the verify page with a token that doesn't exist", async () => {
    await page.goto(verifyPath("not-a-real-token"));
    await settled(page);
    await expect(page.getByRole("heading", { name: "Verification failed" }), "a bad token should show \"Verification failed\"").toBeVisible();
    await expect(
      page.getByText("This link may be expired or already used. Try signing in — if your email isn't verified, you can request a new link.", { exact: true }),
      "a bad token should keep the existing explanatory text",
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to sign in", exact: true }), "a bad token should offer \"Back to sign in\"").toBeVisible();
    await shot(page, testInfo, "bad-token-01-error");
  });
});

test("a second visit to an already-used joining link still names the organization", async ({ page, request }, testInfo) => {
  const company = await companyWithCapturedDomain(request, "second", 5);
  const nia = `e2e-nia-${unique()}@${company.domain}`;
  const token = await registerUnverified(request, nia);

  await test.step("Nia verifies once", async () => {
    await page.goto(verifyPath(token));
    await settled(page);
    await expectJoinedView(page, nia, company.name, "first visit");
  });

  await test.step("Nia opens the same link again in a new tab", async () => {
    const second = await page.context().newPage();
    await second.goto(verifyPath(token));
    await settled(second);
    await expectJoinedView(second, nia, company.name, "second visit");
    await shot(second, testInfo, "second-01-visit");
  });
});

test("a reload after joining keeps the success view and the organization line", async ({ page, request }, testInfo) => {
  const company = await companyWithCapturedDomain(request, "reload", 5);
  const nia = `e2e-nia-${unique()}@${company.domain}`;
  const token = await registerUnverified(request, nia);

  await test.step("Nia verifies", async () => {
    await page.goto(verifyPath(token));
    await settled(page);
    await expectJoinedView(page, nia, company.name, "before reload");
  });

  await test.step("Nia reloads the page", async () => {
    await page.reload();
    await settled(page);
    await expectJoinedView(page, nia, company.name, "after reload");
    await shot(page, testInfo, "reload-01-after-join");
  });
});
