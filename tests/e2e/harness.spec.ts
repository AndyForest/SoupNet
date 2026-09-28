import { expect, test } from "@playwright/test";
import { signInNewContext, seedUser } from "./helpers/accounts";
import { horizontalOverflow } from "./helpers/evidence";

// Pins the harness's own helpers against the traps earlier runs fell into.
// No app pages: setContent, so these run without the dev stack except the
// second-actor test, which needs the backend to seed a user.

test.describe("harness helpers", () => {
  test("horizontalOverflow catches a page too wide for the phone @mobile", async ({ page }) => {
    await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="width:2000px;height:10px"></div>`);
    const m = await horizontalOverflow(page);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    if (test.info().project.name === "mobile") {
      // The trap: on the phone profile innerWidth grows to fit the content.
      expect(innerWidth, "Chrome widens the layout viewport past the device width on the phone profile").toBeGreaterThan(m.deviceWidth);
    }
    expect(m.overflowPx, `a 2000px element must overflow the ${m.deviceWidth}px device`).toBeGreaterThan(0);
  });

  test("horizontalOverflow passes a page that fits @mobile", async ({ page }) => {
    await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="width:100%;height:10px"></div>`);
    expect((await horizontalOverflow(page)).overflowPx).toBe(0);
  });

  test("signInNewContext gives a second actor the project's device settings @mobile", async ({ browser, request }, testInfo) => {
    const user = await seedUser(request, "harness-ctx");
    const { context, page } = await signInNewContext(browser, testInfo, user, "/app/dashboard");
    try {
      expect(page.viewportSize(), "the second actor should use this project's viewport").toEqual(testInfo.project.use.viewport);
      const ua = await page.evaluate(() => navigator.userAgent);
      expect(ua.includes("Mobile"), "the second actor's user agent should match the project (mobile or not)").toBe(testInfo.project.name === "mobile");
    } finally {
      await context.close();
    }
  });
});
