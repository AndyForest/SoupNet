import { expect, test } from "@playwright/test";
import { shot } from "./helpers/evidence";

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
