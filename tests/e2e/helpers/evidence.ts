import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

// Evidence helpers: everything a person needs to judge a step lands in the
// HTML report as a named attachment, in the order the steps ran.

/**
 * Screenshot the page and attach it under a fixed name, e.g. "E2-01-dashboard-error".
 * Names are fixed in the expectations file before the run, so the report and
 * the results file refer to the same image.
 */
export async function shot(page: Page, testInfo: TestInfo, name: string, fullPage = true): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

/**
 * Run an axe accessibility scan, attach the full result, and return the
 * serious and critical violations for the caller to assert on or record.
 */
export async function axeScan(page: Page, testInfo: TestInfo, name: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await testInfo.attach(`${name}-axe.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}, ${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"}): ${v.help}`);
}
