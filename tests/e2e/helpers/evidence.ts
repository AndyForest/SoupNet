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

export interface AxeFindings {
  /** serious and critical: what a spec usually asserts on. */
  blocking: string[];
  moderate: string[];
  minor: string[];
}

const describeViolation = (v: { id: string; impact?: string | null; nodes: unknown[]; help: string }) =>
  `${v.id} (${v.impact}, ${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"}): ${v.help}`;

/**
 * Run an axe accessibility scan, attach the full result, and return every
 * violation grouped by impact, so a spec can record the moderate and minor
 * ones (for example as annotations) without parsing the attachment.
 */
export async function axeFindings(page: Page, testInfo: TestInfo, name: string): Promise<AxeFindings> {
  const results = await new AxeBuilder({ page }).analyze();
  await testInfo.attach(`${name}-axe.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const by = (...impacts: string[]) => results.violations.filter((v) => impacts.includes(v.impact ?? "")).map(describeViolation);
  return { blocking: by("serious", "critical"), moderate: by("moderate"), minor: by("minor") };
}

/** The serious and critical violations only (see axeFindings for the rest). */
export async function axeScan(page: Page, testInfo: TestInfo, name: string): Promise<string[]> {
  return (await axeFindings(page, testInfo, name)).blocking;
}
