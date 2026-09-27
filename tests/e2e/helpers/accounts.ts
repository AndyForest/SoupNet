import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { BACKEND_URL } from "../../../playwright.config";

// Seeded accounts for browser verification.
//
// Each test registers its own throwaway @test.local users through the API, so
// concurrent runs never share state on per-user pages (daily-read ticks,
// membership lists) and `npx tsx scripts/cleanup-test-data.mts` removes them.
// Registration returns the verification token only when the backend runs
// with ALLOW_AUTO_SETUP=true, which the dev Docker stack sets.

export interface SeededUser {
  email: string;
  password: string;
  token: string;
}

const PASSWORD = "e2e-password-123";

export async function seedUser(request: APIRequestContext, label: string): Promise<SeededUser> {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;

  const reg = await request.post(`${BACKEND_URL}/auth/register`, {
    data: { email, password: PASSWORD, tosAccepted: true },
  });
  const regBody = await reg.json();
  expect(reg.ok(), `registering ${email} should succeed; got ${reg.status()} ${JSON.stringify(regBody)}`).toBe(true);
  expect(
    regBody.data?.verificationToken,
    "the dev backend should return a verification token (needs ALLOW_AUTO_SETUP=true)",
  ).toBeTruthy();
  expect(regBody.data?.waitlisted, "a seeded account should not land on the waitlist").toBe(false);

  const ver = await request.post(`${BACKEND_URL}/auth/verify`, { data: { token: regBody.data.verificationToken } });
  expect(ver.ok(), `verifying ${email} should succeed; got ${ver.status()}`).toBe(true);

  const login = await request.post(`${BACKEND_URL}/auth/login`, { data: { email, password: PASSWORD } });
  const loginBody = await login.json();
  expect(login.ok(), `logging in as ${email} should succeed; got ${login.status()}`).toBe(true);

  return { email, password: PASSWORD, token: loginBody.data.token };
}

/** Authorization header for API calls made as a seeded user (fixture setup only). */
export function asUser(user: SeededUser): Record<string, string> {
  return { Authorization: `Bearer ${user.token}` };
}

/**
 * Sign the page in as `user` by writing the same localStorage keys the login
 * page writes (apps/frontend/src/auth.ts), then open `path`. Use the real
 * login form only when the login flow itself is under test.
 *
 * Also dismisses the cookie notice and hides the TanStack Query devtools
 * button (as scripts/screenshot.mjs does), since both cover the bottom of
 * every screenshot. A spec about the cookie notice itself should not use this.
 */
export async function signIn(page: Page, user: SeededUser, path = "/app/dashboard"): Promise<void> {
  await page.addInitScript(
    ([token]) => {
      localStorage.setItem("claimnet_token", token);
      localStorage.setItem("claimnet_email_verified", "true");
      localStorage.setItem("cookie_notice_dismissed", "true");
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent =
          ".tsqd-open-btn-container, .tsqd-parent-container, [data-tanstack-query-devtools] { display: none !important; }";
        document.head.appendChild(style);
      });
    },
    [user.token],
  );
  await page.goto(path);
}
