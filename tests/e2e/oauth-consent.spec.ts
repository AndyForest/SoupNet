import { createHash, randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { BACKEND_URL } from "../../playwright.config";
import { asUser, seedUser, signIn, type SeededUser } from "./helpers/accounts";
import { assertNoHorizontalScroll, shot } from "./helpers/evidence";
import { axeBeyondKnown } from "./drafts-known-issues";

// OAuth consent page, OpenAI plugin directory round, stream O (PR #152;
// rubric docs/planning/openai-plugin-build/oauth.md, rows O1-3, O4-2, O4-3,
// O5-4 and O7-4). Written by an independent browser verifier from the
// rubric's claims and kept as a regression spec under its feature's name
// (recipe 840d65ab). Clients are registered over the API; the consent page is
// opened with the query a client would send. Navigations to the client (or an
// attacker) are fulfilled with a stub page so the browser never leaves the test.

const CLIENT_CB = "https://client.example.com/cb";

/** seedUser, recording the account on the test so the results can list it. */
async function seeded(request: APIRequestContext, label: string): Promise<SeededUser> {
  const user = await seedUser(request, label);
  test.info().annotations.push({ type: "seeded-account", description: user.email });
  return user;
}

function pkceChallenge(): string {
  const verifier = randomBytes(32).toString("base64url");
  return createHash("sha256").update(verifier).digest("base64url");
}

async function registerClient(request: APIRequestContext, name: string, redirectUris = [CLIENT_CB]): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/oauth/register`, { data: { redirect_uris: redirectUris, client_name: name } });
  const body = await res.json();
  expect(res.status(), `registering an OAuth client should return 201; got ${res.status()} ${JSON.stringify(body)}`).toBe(201);
  expect(body.client_id, "registration should return a client_id").toBeTruthy();
  return body.client_id as string;
}

async function issuer(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${BACKEND_URL}/.well-known/oauth-authorization-server`);
  expect(res.ok(), "the authorization server metadata should be served").toBe(true);
  return (await res.json()).issuer as string;
}

async function firstBook(request: APIRequestContext, user: SeededUser): Promise<{ id: string; name: string }> {
  const res = await request.get(`${BACKEND_URL}/recipe-books`, { headers: asUser(user) });
  const body = await res.json();
  expect(res.ok(), `listing the seeded user's recipe books should succeed; got ${res.status()}`).toBe(true);
  expect(body.data?.length, "a seeded user should have at least one recipe book to pick").toBeGreaterThan(0);
  return { id: body.data[0].id, name: body.data[0].name };
}

function consentPath(clientId: string, extra: Record<string, string> = {}, redirectUri = CLIENT_CB): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: "s1",
    code_challenge: pkceChallenge(),
    code_challenge_method: "S256",
    ...extra,
  });
  return `/oauth/authorize?${q.toString()}`;
}

const STUB = (label: string) =>
  `<!doctype html><html lang="en"><head><title>${label} stub</title></head><body><h1>${label} (test stub)</h1><p id="landed"></p><script>document.getElementById("landed").textContent = location.href;</script></body></html>`;

/** Fulfil every request to `pattern` with a stub page; returns the list of requested URLs. */
async function stubHost(page: Page, pattern: string, label: string): Promise<string[]> {
  const seen: string[] = [];
  await page.route(pattern, async (route: Route) => {
    seen.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: STUB(label) });
  });
  return seen;
}

async function openConsent(page: Page, user: SeededUser, path: string, heading: RegExp | string) {
  await signIn(page, user, path);
  await expect(page.getByRole("heading", { level: 1 }), "the consent page should render its heading").toHaveText(heading);
}

test.describe("OAuth consent page (stream O)", () => {
  test("E1 consent for a dynamically registered client says it is unverified and shows the destination", async ({ page, request }, testInfo) => {
    const user = await seeded(request, "oauth-e1");
    const clientId = await registerClient(request, "E1 Client");

    await test.step("open the consent URL a client would send", async () => {
      await openConsent(page, user, consentPath(clientId), "Authorize E1 Client");
    });

    await test.step("check the identity box and the absence of the email sentence", async () => {
      await expect(page.getByRole("heading", { level: 1 }), 'the heading should read "Authorize E1 Client"').toHaveText("Authorize E1 Client");
      const box = page.getByTestId("oauth-client-identity");
      await expect(box, "the identity box should be visible").toBeVisible();
      const text = (await box.innerText()).trim();
      expect(text.startsWith("Unverified app."), `the identity box should start "Unverified app."; got: ${text}`).toBe(true);
      await expect(box, "the identity box should show the redirect destination").toContainText(CLIENT_CB);
      await expect(page.locator("body"), "a client that did not ask for email should get no sentence about the email address").not.toContainText("email address");
      await shot(page, testInfo, "E1-01-consent-dcr");
    });
  });

  test("E2 a client that asks for email is named as asking for the email address", async ({ page, request }, testInfo) => {
    const user = await seeded(request, "oauth-e2");
    const clientId = await registerClient(request, "E2 Client");

    await test.step("open the consent URL with scope=openid email", async () => {
      await openConsent(page, user, consentPath(clientId, { scope: "openid email" }), "Authorize E2 Client");
    });

    await test.step("check the paragraph under the heading", async () => {
      const para = page.locator("h1 + p");
      const text = (await para.innerText()).trim();
      expect(text.endsWith("It also asks to see your email address."), `the paragraph under the heading should end "It also asks to see your email address."; got: ${text}`).toBe(true);
      await shot(page, testInfo, "E2-01-consent-asks-email");
    });

    await test.step("control: the same client without a scope shows no email sentence", async () => {
      await page.goto(consentPath(clientId));
      await expect(page.getByRole("heading", { level: 1 }), "the control consent page should render").toHaveText("Authorize E2 Client");
      await expect(page.locator("h1 + p"), "without scope=email the paragraph should not mention the email address").not.toContainText("email address");
    });
  });

  test("E3 Cancel returns to the client with access_denied, state and iss", async ({ page, request }, testInfo) => {
    const user = await seeded(request, "oauth-e3");
    const clientId = await registerClient(request, "E3 Client");
    const iss = await issuer(request);
    expect(iss, "the metadata issuer should be the backend origin http://127.0.0.1:3171").toBe("http://127.0.0.1:3171");
    const seen = await stubHost(page, "https://client.example.com/**", "client.example.com");

    await test.step("open the consent page", async () => {
      await openConsent(page, user, consentPath(clientId), "Authorize E3 Client");
      await shot(page, testInfo, "E3-01-before-cancel");
    });

    await test.step("click Cancel and land at the client", async () => {
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.waitForURL(/^https:\/\/client\.example\.com\//);
      const url = new URL(page.url());
      expect(`${url.origin}${url.pathname}`, "Cancel should navigate to the registered redirect URI").toBe(CLIENT_CB);
      expect(url.searchParams.get("error"), "the redirect should carry error=access_denied").toBe("access_denied");
      expect(url.searchParams.get("state"), "the redirect should echo state=s1").toBe("s1");
      expect(url.searchParams.get("iss"), "the redirect's iss should equal the metadata issuer byte for byte").toBe(iss);
      expect([...url.searchParams.keys()].sort(), "the redirect should carry exactly error, state and iss").toEqual(["error", "iss", "state"]);
      expect(seen.length, "the browser should have requested the client URL once").toBeGreaterThan(0);
      testInfo.annotations.push({ type: "landed-url", description: page.url() });
      await shot(page, testInfo, "E3-02-landed-at-client");
    });
  });

  test("E4 Authorize returns to the client with code, state and iss", async ({ page, request }, testInfo) => {
    const user = await seeded(request, "oauth-e4");
    const clientId = await registerClient(request, "E4 Client");
    const iss = await issuer(request);
    const book = await firstBook(request, user);
    await stubHost(page, "https://client.example.com/**", "client.example.com");

    await test.step("open the consent page with resource=<backend origin>", async () => {
      await openConsent(page, user, consentPath(clientId, { resource: iss }), "Authorize E4 Client");
    });

    await test.step("pick the user's book as read, write and default", async () => {
      await page.getByRole("checkbox", { name: `Read access to ${book.name}` }).check();
      await page.getByRole("checkbox", { name: `Write access to ${book.name}` }).check();
      const radio = page.getByRole("radio", { name: `Default write to ${book.name}` });
      await radio.check();
      await expect(radio, "the book should be the default write book").toBeChecked();
      await expect(page.getByRole("button", { name: "Authorize" }), "Authorize should be enabled once read, write and default are picked").toBeEnabled();
      await shot(page, testInfo, "E4-01-scope-picked");
    });

    await test.step("click Authorize and land at the client", async () => {
      await page.getByRole("button", { name: "Authorize" }).click();
      await page.waitForURL(/^https:\/\/client\.example\.com\//);
      const url = new URL(page.url());
      expect(`${url.origin}${url.pathname}`, "Authorize should navigate to the registered redirect URI").toBe(CLIENT_CB);
      expect(url.searchParams.get("code") ?? "", "the redirect should carry a non-empty code").not.toBe("");
      expect(url.searchParams.get("state"), "the redirect should echo state=s1").toBe("s1");
      expect(url.searchParams.get("iss"), "the redirect's iss should equal the metadata issuer byte for byte").toBe(iss);
      testInfo.annotations.push({ type: "landed-url", description: page.url().replace(/code=[^&]+/, "code=<redacted>") });
      await shot(page, testInfo, "E4-02-landed-at-client");
    });
  });

  test("E5 a request whose resource is not this server does not authorize", async ({ page, request }, testInfo) => {
    const user = await seeded(request, "oauth-e5");
    const clientId = await registerClient(request, "E5 Client");
    const book = await firstBook(request, user);
    const seen = await stubHost(page, "https://client.example.com/**", "client.example.com");

    await test.step("open the consent page with resource=https://elsewhere.example.com", async () => {
      await openConsent(page, user, consentPath(clientId, { resource: "https://elsewhere.example.com" }), "Authorize E5 Client");
    });

    await test.step("pick books and click Authorize", async () => {
      await page.getByRole("checkbox", { name: `Read access to ${book.name}` }).check();
      await page.getByRole("checkbox", { name: `Write access to ${book.name}` }).check();
      await page.getByRole("radio", { name: `Default write to ${book.name}` }).check();
      const grant = page.waitForResponse((r) => r.url().includes("/oauth/authorize/grant"));
      await page.getByRole("button", { name: "Authorize" }).click();
      const res = await grant;
      testInfo.annotations.push({ type: "grant-response", description: `${res.status()} ${await res.text()}` });
    });

    await test.step("the page stays on Soup.net and shows the resource error", async () => {
      await expect(page.getByText(/resource/i).last(), "the page should show an error that mentions the resource").toBeVisible();
      await page.waitForTimeout(1500);
      expect(new URL(page.url()).origin, "the browser should stay on Soup.net").toBe(new URL(testInfo.project.use.baseURL ?? "").origin);
      expect(seen, "nothing should be requested from the client").toEqual([]);
      await expect(page.getByRole("alert"), 'the error should be announced (role="alert") and carry the server\'s description "resource is not this server"').toContainText("resource is not this server");
      await shot(page, testInfo, "E5-01-refused");
    });
  });

  test("E6 a client_id that names an unreachable metadata document is an unknown client", async ({ page, request }, testInfo) => {
    const user = await seeded(request, "oauth-e6");
    let cimdText = "";

    await test.step("open the consent URL with an unresolvable metadata-document client_id", async () => {
      await signIn(page, user, consentPath("https://cimd-unresolvable.invalid/oauth/client.json"));
      await expect(page.getByRole("heading", { level: 1 }), 'an unfetchable metadata document should give the "Unknown client" heading').toHaveText("Unknown client", { timeout: 20_000 });
      cimdText = (await page.locator("body").innerText()).trim();
      await shot(page, testInfo, "E6-01-cimd-unknown");
    });

    await test.step("control: an unregistered oauth_ id", async () => {
      await page.goto(consentPath("oauth_does_not_exist"));
      await expect(page.getByRole("heading", { level: 1 }), 'an unregistered oauth_ id should give the "Unknown client" heading').toHaveText("Unknown client");
      const controlText = (await page.locator("body").innerText()).trim();
      expect(cimdText, "the metadata-document case should show the same page as an unregistered id").toBe(controlText);
      await shot(page, testInfo, "E6-02-control-unregistered");
    });
  });

  test("E7 Cancel with a redirect_uri the client did not register never leaves Soup.net", async ({ page, request }, testInfo) => {
    const user = await seeded(request, "oauth-e7");
    const clientId = await registerClient(request, "E7 Client");
    const attacker = await stubHost(page, "https://attacker.example/**", "attacker.example");
    const client = await stubHost(page, "https://client.example.com/**", "client.example.com");

    await test.step("open the consent URL with redirect_uri=https://attacker.example/cb", async () => {
      await signIn(page, user, consentPath(clientId, {}, "https://attacker.example/cb"));
      await expect(page.getByRole("heading", { level: 1 }), "the page should refuse up front").toHaveText("Invalid OAuth request");
      await expect(page.locator("body"), "the refusal should say the redirect_uri is not registered for this client").toContainText(
        "The redirect_uri in this request is not registered for this client",
      );
    });

    await test.step("no Authorize or Cancel control leads to attacker.example", async () => {
      await expect(page.getByRole("button", { name: "Authorize" }), "the refusal page should offer no Authorize button").toHaveCount(0);
      await expect(page.getByRole("button", { name: "Cancel" }), "the refusal page should offer no Cancel button").toHaveCount(0);
      const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(hrefs.filter((h) => h.includes("attacker.example")), "no link on the page should point at attacker.example").toEqual([]);
      expect(attacker, "nothing should be requested from attacker.example").toEqual([]);
      expect(client, "nothing should be requested from the client either").toEqual([]);
      await shot(page, testInfo, "E7-01-unregistered-redirect");
    });
  });

  test.describe("loopback redirects (RFC 8252 section 7.3, F129)", () => {
    const CODEX_ID = "https://chatgpt.com/oauth/codex/client.json";
    const ON_PORT = "http://127.0.0.1:57687/callback";
    const COPY_WARNING = "Never copy the address of the next page into anything";

    test("L1 Codex's real document on an ephemeral port: the warning, Authorize, and the token request", async ({ page, request }, testInfo) => {
      const user = await seeded(request, "oauth-l1");
      const iss = await issuer(request);
      const book = await firstBook(request, user);
      await stubHost(page, "http://127.0.0.1:57687/**", "local app");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");

      await test.step("open the consent URL Codex sends", async () => {
        await openConsent(page, user, consentPath(CODEX_ID, { resource: iss, code_challenge: challenge }, ON_PORT), "Authorize Codex");
      });

      await test.step("the page warns and doesn't vouch", async () => {
        const box = page.getByTestId("oauth-client-identity");
        await expect(box, "the box should say the sign-in finishes in an app on this computer").toContainText("This sign-in finishes in an app on this computer.");
        await expect(box, "the box should name the document's domain").toContainText("comes from a document on chatgpt.com");
        await expect(box, "the box should show the full redirect, port included").toContainText(ON_PORT);
        await expect(box, "the box should warn against copying the next page's address").toContainText(COPY_WARNING);
        await expect(box, 'the box should not say "Published by" on a loopback redirect').not.toContainText("Published by");
        await shot(page, testInfo, "L1-01-consent-codex-loopback");
      });

      await test.step("Authorize lands on the port Codex listens on", async () => {
        await page.getByRole("checkbox", { name: `Read access to ${book.name}` }).check();
        await page.getByRole("checkbox", { name: `Write access to ${book.name}` }).check();
        await page.getByRole("radio", { name: `Default write to ${book.name}` }).check();
        await page.getByRole("button", { name: "Authorize" }).click();
        await page.waitForURL(/^http:\/\/127\.0\.0\.1:57687\//);
      });

      const code = new URL(page.url()).searchParams.get("code") ?? "";
      const redeem = (redirectUri: string, codeToUse = code) =>
        request.post(`${BACKEND_URL}/oauth/token`, {
          form: { grant_type: "authorization_code", code: codeToUse, code_verifier: verifier, client_id: CODEX_ID, redirect_uri: redirectUri, resource: iss },
        });

      await test.step("the token request succeeds with no credential and the same URI", async () => {
        expect(code, "the redirect should carry a code").not.toBe("");
        const res = await redeem(ON_PORT);
        const body = await res.json();
        expect(res.status(), `redeeming as a public client should return 200; got ${res.status()} ${JSON.stringify(body.error ?? "")}`).toBe(200);
        expect(body.access_token, "the response should carry an access token").toBeTruthy();
      });
    });

    test("L2 Cancel on Codex's document reaches the port with access_denied", async ({ page, request }, testInfo) => {
      const user = await seeded(request, "oauth-l2");
      await stubHost(page, "http://127.0.0.1:57687/**", "local app");
      await openConsent(page, user, consentPath(CODEX_ID, {}, ON_PORT), "Authorize Codex");
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.waitForURL(/^http:\/\/127\.0\.0\.1:57687\//);
      expect(new URL(page.url()).searchParams.get("error"), "the redirect should carry error=access_denied").toBe("access_denied");
      await shot(page, testInfo, "L2-01-cancel-landed");
    });

    test("L3 a dynamically registered client on loopback stays unverified and gets the same warning", async ({ page, request }, testInfo) => {
      const user = await seeded(request, "oauth-l3");
      const clientId = await registerClient(request, "L3 Client", ["http://127.0.0.1/callback"]);
      await openConsent(page, user, consentPath(clientId, {}, ON_PORT), "Authorize L3 Client");
      const box = page.getByTestId("oauth-client-identity");
      const text = (await box.innerText()).trim();
      expect(text.startsWith("Unverified app."), `the identity box should start "Unverified app."; got: ${text}`).toBe(true);
      await expect(box, "the box should say the sign-in finishes in an app on this computer").toContainText("finishes in an app on this computer");
      await expect(box, "the box should warn against copying the next page's address").toContainText(COPY_WARNING);
      await expect(box, "the box should show the full redirect, port included").toContainText(ON_PORT);
      await shot(page, testInfo, "L3-01-consent-dcr-loopback");
    });

    test("L4 Codex's document with a different path is refused up front", async ({ page, request }, testInfo) => {
      const user = await seeded(request, "oauth-l4");
      await signIn(page, user, consentPath(CODEX_ID, {}, "http://127.0.0.1:57687/other"));
      await expect(page.getByRole("heading", { level: 1 }), "the page should refuse a path the document doesn't register").toHaveText("Invalid OAuth request", { timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Authorize" }), "the refusal should offer no Authorize button").toHaveCount(0);
      await shot(page, testInfo, "L4-01-refused");
    });

    test("L5 https keeps its copy: E1's wording has no loopback warning", async ({ page, request }, testInfo) => {
      const user = await seeded(request, "oauth-l5");
      const clientId = await registerClient(request, "L5 Client");
      await openConsent(page, user, consentPath(clientId), "Authorize L5 Client");
      const box = page.getByTestId("oauth-client-identity");
      await expect(box, "an https redirect should keep the original closing line").toContainText("Only continue if you started this connection yourself from that app.");
      await expect(box, "an https redirect should not get the loopback warning").not.toContainText(COPY_WARNING);
      await shot(page, testInfo, "L5-01-https-unchanged");
    });

    test("L6 @mobile the warning fits on a phone, and axe finds nothing new", async ({ page, request }, testInfo) => {
      const user = await seeded(request, "oauth-l6");
      await openConsent(page, user, consentPath(CODEX_ID, {}, ON_PORT), "Authorize Codex");
      await assertNoHorizontalScroll(page, testInfo, "consent page with the loopback warning");
      const r = await axeBeyondKnown(page, testInfo, "L6-axe-loopback");
      expect.soft(r.blocking, "the loopback consent page should have no serious or critical axe violations beyond the known list").toEqual([]);
      await shot(page, testInfo, "L6-01-loopback-layout");
    });
  });

  test("X1 axe scan of the consent page in the E1 and E2 states", async ({ page, request }, testInfo) => {
    const user = await seeded(request, "oauth-x1");
    const clientId = await registerClient(request, "X1 Client");

    await test.step("E1 state (no scope)", async () => {
      await openConsent(page, user, consentPath(clientId), "Authorize X1 Client");
      const r = await axeBeyondKnown(page, testInfo, "X1-axe-e1-state");
      for (const m of r.moderate) testInfo.annotations.push({ type: "axe-moderate (E1 state)", description: m });
      expect.soft(r.blocking, "the E1-state consent page should have no serious or critical axe violations beyond the known list").toEqual([]);
    });

    await test.step("E2 state (scope=openid email)", async () => {
      await page.goto(consentPath(clientId, { scope: "openid email" }));
      await expect(page.getByRole("heading", { level: 1 }), "the E2-state page should render").toHaveText("Authorize X1 Client");
      const r = await axeBeyondKnown(page, testInfo, "X1-axe-e2-state");
      for (const m of r.moderate) testInfo.annotations.push({ type: "axe-moderate (E2 state)", description: m });
      expect.soft(r.blocking, "the E2-state consent page should have no serious or critical axe violations beyond the known list").toEqual([]);
    });
  });

  test("X2 keyboard only: Tab reaches the book picker, Authorize and Cancel; Enter on Cancel performs E3", async ({ page, request }, testInfo) => {
    const user = await seeded(request, "oauth-x2");
    const clientId = await registerClient(request, "X2 Client");
    const book = await firstBook(request, user);
    const iss = await issuer(request);
    await stubHost(page, "https://client.example.com/**", "client.example.com");

    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return "";
        return `${el.tagName.toLowerCase()}|${el.getAttribute("type") ?? ""}|${el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""}`;
      });

    const order: string[] = [];
    async function tabUntil(pred: (f: string) => boolean, max = 40): Promise<boolean> {
      for (let i = 0; i < max; i++) {
        await page.keyboard.press("Tab");
        const f = await focused();
        order.push(f);
        if (pred(f)) return true;
      }
      return false;
    }

    await test.step("open the consent page", async () => {
      await openConsent(page, user, consentPath(clientId), "Authorize X2 Client");
      await page.locator("body").focus();
    });

    await test.step("Tab to the read and write checkboxes and tick them with Space", async () => {
      expect(await tabUntil((f) => f.includes(`Read access to ${book.name}`)), "Tab should reach the read checkbox in the book picker").toBe(true);
      await page.keyboard.press("Space");
      expect(await tabUntil((f) => f.includes(`Write access to ${book.name}`)), "Tab should reach the write checkbox in the book picker").toBe(true);
      await page.keyboard.press("Space");
      await expect(page.getByRole("radio", { name: `Default write to ${book.name}` }), "ticking write should make the book the default").toBeChecked();
    });

    await test.step("Tab reaches Authorize, then Cancel", async () => {
      expect(await tabUntil((f) => f === "button|button|Authorize"), "Tab should reach the Authorize button").toBe(true);
      expect(await tabUntil((f) => f === "button|button|Cancel"), "Tab should reach the Cancel button").toBe(true);
      testInfo.annotations.push({ type: "tab-order", description: order.join("  →  ") });
    });

    await test.step("Enter on Cancel performs E3", async () => {
      await page.keyboard.press("Enter");
      await page.waitForURL(/^https:\/\/client\.example\.com\//);
      const url = new URL(page.url());
      expect(`${url.origin}${url.pathname}`, "Enter on Cancel should navigate to the registered redirect URI").toBe(CLIENT_CB);
      expect(url.searchParams.get("error"), "Enter on Cancel should carry error=access_denied").toBe("access_denied");
      expect(url.searchParams.get("state"), "Enter on Cancel should echo state=s1").toBe("s1");
      expect(url.searchParams.get("iss"), "Enter on Cancel should carry iss equal to the issuer").toBe(iss);
    });
  });
});
