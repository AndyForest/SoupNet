import { expect, test } from "@playwright/test";
import { shot } from "./helpers/evidence";
import { BACKEND_URL } from "../../playwright.config";

// Cloudflare Turnstile on the signup form. Needs a frontend built or served
// with one of Cloudflare's published test site keys, and internet access:
//   VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run dev:frontend   (always passes)
//   E2E_TURNSTILE=pass npx playwright test turnstile
// With 2x00000000000000000000AB (always blocks) and E2E_TURNSTILE=block,
// the block test runs instead. Skipped when E2E_TURNSTILE is unset.
const mode = process.env["E2E_TURNSTILE"];

test.describe("signup bot check (Turnstile)", () => {
  test("the widget passes and the registration carries its token", async ({ page }, testInfo) => {
    test.skip(mode !== "pass", "set E2E_TURNSTILE=pass with the always-pass test site key");
    let sentToken: unknown;
    await page.route("**/auth/register", async (route) => {
      if (route.request().method() !== "POST") return route.continue(); // the SPA page shares the path
      sentToken = (route.request().postDataJSON() as { turnstileToken?: unknown }).turnstileToken;
      await route.fulfill({ json: { ok: true, data: { waitlisted: false, message: "stub" } } });
    });

    await page.goto("/auth/register");
    // Turnstile draws its iframe in a shadow root, so the spec checks what
    // the app sees: the widget's container, then the token in the request.
    await expect(page.getByTestId("turnstile"), "the Turnstile widget should render on the signup form").toBeVisible();
    await page.getByLabel(/email/i).fill(`turnstile-${Date.now()}@test.local`);
    await page.getByLabel(/password/i).first().fill("turnstile-pass-123");
    await page.locator("#tos").check();
    // Until the widget issues its token the form refuses; retry the click.
    await expect(async () => {
      await page.getByRole("button", { name: /create account/i }).click();
      expect(sentToken, "the registration request should include the Turnstile token").toEqual(expect.stringMatching(/.+/));
    }).toPass({ timeout: 20_000 });
    await shot(page, testInfo, "turnstile-01-submitted-with-token");
  });

  test("a blocked check keeps the form from submitting, with a message", async ({ page }, testInfo) => {
    test.skip(mode !== "block", "set E2E_TURNSTILE=block with the always-block test site key");
    let called = false;
    await page.route("**/auth/register", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      called = true;
      await route.abort();
    });
    await page.goto("/auth/register");
    await expect(page.getByTestId("turnstile"), "the widget should render").toBeVisible();
    await page.waitForTimeout(3_000); // give the always-block key time to decide
    await page.getByLabel(/email/i).fill(`turnstile-${Date.now()}@test.local`);
    await page.getByLabel(/password/i).first().fill("turnstile-pass-123");
    await page.locator("#tos").check();
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByText("Please complete the check above the button first."), "without a token the form should say what's missing").toBeVisible();
    expect(called, "no registration request should be sent without a token").toBe(false);
    await shot(page, testInfo, "turnstile-03-blocked");
  });
});

// The other pages that send an email to an address the visitor may not own.
// Same keys and E2E_TURNSTILE modes as above. The backend replies are
// intercepted (the widget and the request are under test here; the backend's
// check is covered by routes/auth-turnstile.test.ts).
test.describe("email-sending pages (Turnstile)", () => {
  test("password reset sends its token with the always-pass key", async ({ page }, testInfo) => {
    test.skip(mode !== "pass", "set E2E_TURNSTILE=pass with the always-pass test site key");
    let sentToken: unknown;
    await page.route("**/auth/forgot-password", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      sentToken = (route.request().postDataJSON() as { turnstileToken?: unknown }).turnstileToken;
      await route.fulfill({ json: { ok: true, data: { message: "stub" } } });
    });
    await page.goto("/auth/forgot-password");
    await expect(page.getByTestId("turnstile"), "the widget should render on the reset form").toBeVisible();
    await page.getByLabel(/email/i).fill(`turnstile-${Date.now()}@test.local`);
    await expect(async () => {
      await page.getByRole("button", { name: /send reset link/i }).click();
      expect(sentToken, "the reset request should carry the Turnstile token").toEqual(expect.stringMatching(/.+/));
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText(/If an account exists for/), "the confirmation shows once the request is accepted").toBeVisible();
    await shot(page, testInfo, "turnstile-10-reset-sent");
  });

  test("password reset refuses to submit when the check blocks", async ({ page }, testInfo) => {
    test.skip(mode !== "block", "set E2E_TURNSTILE=block with the always-block test site key");
    let called = false;
    await page.route("**/auth/forgot-password", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      called = true;
      await route.abort();
    });
    await page.goto("/auth/forgot-password");
    await expect(page.getByTestId("turnstile")).toBeVisible();
    await page.waitForTimeout(3_000);
    await page.getByLabel(/email/i).fill(`turnstile-${Date.now()}@test.local`);
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByText("Please complete the check above the button first."), "without a token the form should say what's missing").toBeVisible();
    expect(called, "no reset request should be sent without a token").toBe(false);
    await shot(page, testInfo, "turnstile-11-reset-blocked");
  });

  test("verification resend sends its token with the always-pass key", async ({ page, request }, testInfo) => {
    test.skip(mode !== "pass", "set E2E_TURNSTILE=pass with the always-pass test site key");
    // A real unverified account, signed in (the page needs /auth/me).
    const email = `e2e-unverified-${Date.now()}@test.local`;
    const password = "turnstile-pass-123";
    await request.post(`${BACKEND_URL}/auth/register`, { data: { email, password, tosAccepted: true } });
    const login = await request.post(`${BACKEND_URL}/auth/login`, { data: { email, password } });
    const token = ((await login.json()) as { data?: { token?: string } }).data?.token;
    expect(token, "an unverified account can still sign in").toBeTruthy();
    await page.addInitScript(([t]) => {
      localStorage.setItem("claimnet_token", t);
      localStorage.setItem("claimnet_email_verified", "false");
      localStorage.setItem("cookie_notice_dismissed", "true");
    }, [token!]);

    let sentToken: unknown;
    await page.route("**/auth/resend-verification", async (route) => {
      sentToken = (route.request().postDataJSON() as { turnstileToken?: unknown }).turnstileToken;
      await route.fulfill({ json: { ok: true, data: { message: "stub" } } });
    });
    await page.goto("/auth/verify-pending");
    await expect(page.getByTestId("turnstile"), "the widget should render above the resend button").toBeVisible();
    await expect(async () => {
      await page.getByRole("button", { name: /resend verification email/i }).click();
      expect(sentToken, "the resend request should carry the Turnstile token").toEqual(expect.stringMatching(/.+/));
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /email sent/i })).toBeVisible();
    await shot(page, testInfo, "turnstile-12-resend-sent");
  });

  test("a waitlisted, unverified sign-in shows the check and re-signs in with a token", async ({ page }, testInfo) => {
    test.skip(mode !== "pass", "set E2E_TURNSTILE=pass with the always-pass test site key");
    const tokens: unknown[] = [];
    await page.route("**/auth/login", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      tokens.push((route.request().postDataJSON() as { turnstileToken?: unknown }).turnstileToken);
      await route.fulfill({
        status: 403,
        // Like the backend: the check is asked for until a token comes with the sign-in.
        json: { ok: false, error: "waitlisted", verified: false, turnstileRequired: !tokens.at(-1), message: "stub" },
      });
    });
    await page.goto("/auth/login");
    await expect(page.getByTestId("turnstile"), "a normal sign-in form has no widget").toHaveCount(0);
    await page.getByLabel(/email/i).fill(`turnstile-${Date.now()}@test.local`);
    await page.getByLabel(/password/i).first().fill("turnstile-pass-123");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByText(/complete the check above and sign in again/), "the page should ask for the check").toBeVisible();
    await expect(page.getByTestId("turnstile"), "the widget appears after the backend asks for it").toBeVisible();
    await shot(page, testInfo, "turnstile-13a-waitlisted-signin-asks-for-check");
    await expect(async () => {
      await page.getByRole("button", { name: /^sign in$/i }).click();
      expect(tokens.at(-1), "the second sign-in should carry the Turnstile token").toEqual(expect.stringMatching(/.+/));
    }).toPass({ timeout: 20_000 });
    expect(tokens[0], "the first sign-in carries no token").toBeUndefined();
    await shot(page, testInfo, "turnstile-13b-waitlisted-signin-after-check");
  });
});
