import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

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

// Names up to three failing elements, so a result says which ones failed.
const describeViolation = (v: { id: string; impact?: string | null; nodes: Array<{ target: unknown[] }>; help: string }) => {
  const targets = v.nodes.slice(0, 3).map((n) => n.target.map(String).join(" ")).join(", ");
  const more = v.nodes.length > 3 ? `, +${v.nodes.length - 3} more` : "";
  return `${v.id} (${v.impact}, ${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"}): ${v.help} [${targets}${more}]`;
};

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

/**
 * How far the page's content is wider than the device. Compare with the
 * page's configured viewport width, never window.innerWidth or the root's
 * clientWidth: with isMobile (the Pixel 7 project) Chrome widens the layout
 * viewport to fit over-wide content, so those grow with the overflow and a
 * page 1232px wide "fits" a 1232px viewport on a 412px phone.
 */
export async function horizontalOverflow(page: Page): Promise<{ contentWidth: number; deviceWidth: number; overflowPx: number }> {
  const deviceWidth = page.viewportSize()?.width;
  if (!deviceWidth) throw new Error("horizontalOverflow needs a page with a fixed viewport");
  const contentWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0));
  return { contentWidth, deviceWidth, overflowPx: Math.max(0, contentWidth - deviceWidth) };
}

/** Soft-assert the page fits the device width; attaches the measurement. */
export async function assertNoHorizontalScroll(page: Page, testInfo: TestInfo, label: string) {
  const m = await horizontalOverflow(page);
  await testInfo.attach(`${label}-overflow.json`, { body: JSON.stringify(m), contentType: "application/json" });
  expect.soft(m.contentWidth, `${label} should fit the ${m.deviceWidth}px device width without horizontal scrolling`).toBeLessThanOrEqual(m.deviceWidth);
  return m;
}
