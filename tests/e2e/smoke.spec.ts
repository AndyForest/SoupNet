import { expect, test } from "@playwright/test";
import { seedUser, signIn } from "./helpers/accounts";
import { shot } from "./helpers/evidence";

// Proves the harness reaches the stack: a seeded account signs in and the
// dashboard renders. Run it first when a verification run fails oddly.
test("a seeded account reaches the dashboard @mobile", async ({ page, request }, testInfo) => {
  const user = await seedUser(request, "smoke");

  await test.step("sign in and open the dashboard", async () => {
    await signIn(page, user);
    await expect(page, "a signed-in, verified user should stay on the dashboard, not bounce to login").toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("main"), "the dashboard should render its main region").toBeVisible();
    await shot(page, testInfo, "smoke-dashboard");
  });
});
