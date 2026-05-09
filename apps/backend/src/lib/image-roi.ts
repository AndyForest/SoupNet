/**
 * Region-of-interest image processing for multimodal embeddings.
 *
 * See ADR-0019 for the full rationale. Summary: when a user marks a region
 * on an image, we crop to ROI + padding, apply a gaussian blur to the
 * padding (leaving the ROI pixel-sharp), and pass the processed image to
 * Gemini embedding-2-preview. FGVP (NeurIPS 2023) shows blur-reverse-mask
 * outperforms drawn markers by 12-17 points on RefCOCO — that's our first-
 * pass choice. Original bytes are stored separately so the technique can
 * be swapped later without data migration.
 *
 * The exported {@link VISUAL_CUE_VERSION} bumps when the cue changes; it's
 * included in the embedding content hash so old cached vectors don't match
 * new requests after a cue change.
 */

import sharp from "sharp";

/**
 * Normalized region-of-interest box. All coordinates are fractions in [0, 1]
 * with top-left origin and y-grows-downward.
 */
export interface ImageBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Region metadata persisted on the reference row. Extensible across media
 * types — future fields will include `time_range` (video/audio) and
 * `page_range` (PDF).
 */
export interface RegionMeta {
  image_box?: ImageBox;
  // Future: time_range?: { start_seconds: number; end_seconds: number };
  // Future: page_range?: { first_page: number; last_page: number };
}

/**
 * Version tag for the visual-cue pipeline. Included in the embedding content
 * hash so a cue change invalidates stale cached vectors automatically.
 */
export const VISUAL_CUE_VERSION = "blur-reverse-mask-v1";

/**
 * Padding fraction applied on each side of the ROI before cropping. 15% is
 * an informed first-pass guess; see ADR-0019 open questions for empirical
 * validation plan.
 */
const PADDING_FRACTION = 0.15;

/**
 * Gaussian blur sigma applied to the padding region. Tuned empirically
 * against FGVP's descriptions; may need adjustment after A/B testing.
 */
const BLUR_SIGMA = 10;

/** Validate that an ImageBox has coordinates in range and x0<x1, y0<y1. */
export function validateImageBox(box: ImageBox): string | null {
  for (const [name, v] of Object.entries(box)) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return `image_box.${name} must be a finite number`;
    }
    if (v < 0 || v > 1) {
      return `image_box.${name} must be in [0, 1] (got ${v})`;
    }
  }
  if (box.x0 >= box.x1) {
    return `image_box.x0 (${box.x0}) must be less than image_box.x1 (${box.x1})`;
  }
  if (box.y0 >= box.y1) {
    return `image_box.y0 (${box.y0}) must be less than image_box.y1 (${box.y1})`;
  }
  return null;
}

/**
 * Apply the visual cue for a region of interest.
 *
 * Input: an image buffer (any Sharp-supported format) and a normalized box.
 * Output: a processed image buffer where the ROI is pixel-sharp and the
 * surrounding padding is gaussian-blurred. The output is encoded in the
 * same format as the input (PNG stays PNG, JPEG stays JPEG, etc.).
 *
 * The processing is deterministic: same input bytes + same box + same
 * version = same output bytes. Safe to use in content-hash cache keys.
 */
export async function applyVisualCue(
  imageBuffer: Buffer,
  box: ImageBox,
): Promise<{ buffer: Buffer; mimeType: string; version: string }> {
  const validation = validateImageBox(box);
  if (validation) throw new Error(`Invalid image_box: ${validation}`);

  const input = sharp(imageBuffer, { failOn: "error" });
  const metadata = await input.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read image dimensions");
  }
  const imgW = metadata.width;
  const imgH = metadata.height;
  const format = metadata.format ?? "png";

  // Pixel coordinates of the ROI within the original image.
  const roiX0 = Math.round(box.x0 * imgW);
  const roiY0 = Math.round(box.y0 * imgH);
  const roiX1 = Math.round(box.x1 * imgW);
  const roiY1 = Math.round(box.y1 * imgH);
  const roiW = Math.max(1, roiX1 - roiX0);
  const roiH = Math.max(1, roiY1 - roiY0);

  // Crop window: ROI plus padding, clamped to image bounds.
  const padX = Math.round(roiW * PADDING_FRACTION);
  const padY = Math.round(roiH * PADDING_FRACTION);
  const cropX0 = Math.max(0, roiX0 - padX);
  const cropY0 = Math.max(0, roiY0 - padY);
  const cropX1 = Math.min(imgW, roiX1 + padX);
  const cropY1 = Math.min(imgH, roiY1 + padY);
  const cropW = cropX1 - cropX0;
  const cropH = cropY1 - cropY0;

  // ROI coordinates relative to the cropped frame.
  const roiInCropX = roiX0 - cropX0;
  const roiInCropY = roiY0 - cropY0;

  // Step 1: Extract the cropped region (sharp copy).
  const sharpCrop = await sharp(imageBuffer)
    .extract({ left: cropX0, top: cropY0, width: cropW, height: cropH })
    .toBuffer();

  // Step 2: Blur the entire crop.
  const blurredCrop = await sharp(sharpCrop).blur(BLUR_SIGMA).toBuffer();

  // Step 3: Extract the unblurred ROI rectangle from the original.
  const sharpRoi = await sharp(imageBuffer)
    .extract({ left: roiX0, top: roiY0, width: roiW, height: roiH })
    .toBuffer();

  // Step 4: Composite the sharp ROI back onto the blurred crop at its
  // original position within the crop. Result: ROI sharp, padding blurred.
  const composed = await sharp(blurredCrop)
    .composite([{ input: sharpRoi, left: roiInCropX, top: roiInCropY }])
    .toFormat(format as keyof sharp.FormatEnum)
    .toBuffer();

  return {
    buffer: composed,
    mimeType: mimeTypeForFormat(format),
    version: VISUAL_CUE_VERSION,
  };
}

/**
 * Text hint appended to the multimodal embedding's text part when a visual
 * cue is applied. Tells Gemini that the blur is artificial so it doesn't
 * interpret it as a property of the original image.
 */
export function roiTextHint(box: ImageBox): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `(ROI applied to the attached image: the user marked the region from (${pct(box.x0)}, ${pct(box.y0)}) to (${pct(box.x1)}, ${pct(box.y1)}) (fractions of width × height, top-left origin). The padding outside that region has been artificially blurred during pipeline processing to focus embedding attention on the sharp ROI. The blur is a pipeline artifact, not a property of the original image.)`;
}

function mimeTypeForFormat(format: string): string {
  switch (format) {
    case "png": return "image/png";
    case "jpeg":
    case "jpg": return "image/jpeg";
    case "webp": return "image/webp";
    default: return "image/png";
  }
}
