import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The browser harness finds the review queue by this test id
// (post-merge findings, 2026-09-29). There is no component-test setup, so
// the page source is read directly: the id sits on the page's root element.
describe("DraftQueuePage", () => {
  it("marks its root element with data-testid=\"drafts-queue\"", () => {
    const src = readFileSync(fileURLToPath(new URL("./DraftQueuePage.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/return \(\s*<div data-testid="drafts-queue">/);
  });
});
