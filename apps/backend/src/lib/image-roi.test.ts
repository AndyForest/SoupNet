import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { applyVisualCue, validateImageBox, roiTextHint, VISUAL_CUE_VERSION } from "./image-roi";

/** Build a synthetic PNG with a known solid-red ROI and a solid-green surround.
 *  Returns the bytes plus the dimensions. */
async function makeTestImage(width: number, height: number): Promise<Buffer> {
  // Start with a green canvas, paint a red rectangle in the center third.
  const canvas = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 255, b: 0 } },
  }).png().toBuffer();
  // The ROI is x=[1/3, 2/3], y=[1/3, 2/3]. Composite a red rect there.
  const redRect = await sharp({
    create: {
      width: Math.round(width / 3),
      height: Math.round(height / 3),
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  }).png().toBuffer();
  return sharp(canvas)
    .composite([{ input: redRect, left: Math.round(width / 3), top: Math.round(height / 3) }])
    .png()
    .toBuffer();
}

describe("validateImageBox", () => {
  it("accepts a normal box", () => {
    expect(validateImageBox({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.8 })).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(validateImageBox({ x0: -0.1, y0: 0, x1: 0.5, y1: 1 })).toMatch(/in \[0, 1\]/);
    expect(validateImageBox({ x0: 0, y0: 0, x1: 1.5, y1: 1 })).toMatch(/in \[0, 1\]/);
  });

  it("rejects inverted x coordinates", () => {
    expect(validateImageBox({ x0: 0.5, y0: 0, x1: 0.1, y1: 1 })).toMatch(/x0.*must be less than.*x1/);
  });

  it("rejects inverted y coordinates", () => {
    expect(validateImageBox({ x0: 0, y0: 0.8, x1: 1, y1: 0.2 })).toMatch(/y0.*must be less than.*y1/);
  });

  it("rejects NaN and Infinity", () => {
    expect(validateImageBox({ x0: NaN, y0: 0, x1: 1, y1: 1 })).toMatch(/finite/);
    expect(validateImageBox({ x0: 0, y0: 0, x1: Infinity, y1: 1 })).toMatch(/finite/);
  });
});

describe("applyVisualCue", () => {
  it("produces a cropped image with the ROI preserved and padding blurred", async () => {
    const original = await makeTestImage(300, 300);
    const box = { x0: 1 / 3, y0: 1 / 3, x1: 2 / 3, y1: 2 / 3 };
    const result = await applyVisualCue(original, box);

    expect(result.version).toBe(VISUAL_CUE_VERSION);
    expect(result.mimeType).toBe("image/png");

    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBeDefined();
    expect(meta.height).toBeDefined();
    // Crop should be smaller than original (ROI is only 1/3 each side + padding)
    expect(meta.width!).toBeLessThan(300);
    expect(meta.height!).toBeLessThan(300);
  });

  it("is deterministic — same inputs produce identical output bytes", async () => {
    const original = await makeTestImage(200, 200);
    const box = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 };
    const a = await applyVisualCue(original, box);
    const b = await applyVisualCue(original, box);
    expect(a.buffer.equals(b.buffer)).toBe(true);
  });

  it("rejects an invalid box", async () => {
    const original = await makeTestImage(100, 100);
    await expect(applyVisualCue(original, { x0: 0.5, y0: 0, x1: 0.1, y1: 1 })).rejects.toThrow(/x0.*less than.*x1/);
  });

  it("clamps padding to image bounds at the edges", async () => {
    const original = await makeTestImage(200, 200);
    // ROI covers the full image — padding should clamp, no crash.
    const result = await applyVisualCue(original, { x0: 0, y0: 0, x1: 1, y1: 1 });
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
  });
});

describe("roiTextHint", () => {
  it("formats a readable description with percentage coordinates", () => {
    const hint = roiTextHint({ x0: 0.1, y0: 0.2, x1: 0.55, y1: 0.6 });
    expect(hint).toContain("10%");
    expect(hint).toContain("20%");
    expect(hint).toContain("55%");
    expect(hint).toContain("60%");
    expect(hint).toContain("blurred");
    expect(hint).toContain("pipeline artifact");
  });
});
