import type { PostVariant, PostSlide } from "../../types/index.js";

export interface VariantValidationResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Accept variant iff:
 * - ≥ 1 slide present
 * - every slide has non-empty image reference (hasImage) OR non-empty text (hasText / html)
 * - caption is non-empty
 * Explicit CTA is optional — absence must NOT cause failure.
 * Property 20 / Requirement 8.4.
 */
export function validatePostVariant(
  variant: Pick<PostVariant, "slides" | "caption" | "cta">,
): VariantValidationResult {
  const reasons: string[] = [];

  if (!variant.slides || variant.slides.length < 1) {
    reasons.push("at least one slide is required");
  } else {
    for (let i = 0; i < variant.slides.length; i++) {
      const slide = variant.slides[i];
      if (!slideHasContent(slide)) {
        reasons.push(
          `slide[${i}] must contain a non-empty image reference or non-empty text`,
        );
      }
    }
  }

  if (!variant.caption || variant.caption.trim() === "") {
    reasons.push("caption is required and must be non-empty");
  }

  // CTA intentionally ignored — optional per Req 8.4

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

function slideHasContent(slide: PostSlide): boolean {
  const hasImage = slide.hasImage === true;
  const hasText =
    slide.hasText === true ||
    (typeof slide.html === "string" && slide.html.trim() !== "");
  return hasImage || hasText;
}

export interface DiscardResult {
  valid: PostVariant[];
  discarded: PostVariant[];
  discardedCount: number;
  notification: string;
}

/**
 * Discard invalid variants; preserve all valid ones; notify of discarded count.
 * Requirement 8.8.
 */
export function discardInvalidVariants(
  variants: PostVariant[],
): DiscardResult {
  const valid: PostVariant[] = [];
  const discarded: PostVariant[] = [];

  for (const v of variants) {
    const result = validatePostVariant(v);
    if (result.valid) {
      valid.push({ ...v, validationStatus: "valid" });
    } else {
      discarded.push({ ...v, validationStatus: "invalid" });
    }
  }

  return {
    valid,
    discarded,
    discardedCount: discarded.length,
    notification:
      discarded.length === 0
        ? "All variants passed validation."
        : `${discarded.length} variant(s) discarded due to validation failure.`,
  };
}

export interface HumanEditInput {
  caption?: string;
  cta?: string;
  hashtags?: string[];
  slides?: PostSlide[];
}

export const MAX_REGENERATION_RETRIES = 3;

/**
 * Apply a human edit: tag as "human_edited", cap regenerationRetryCount at 3.
 * Property 21 / Requirement 8.9.
 */
export function applyHumanEdit(
  variant: PostVariant,
  edits: HumanEditInput,
  incrementRetry = true,
): PostVariant {
  const nextRetry = incrementRetry
    ? Math.min(
        (variant.regenerationRetryCount ?? 0) + 1,
        MAX_REGENERATION_RETRIES,
      )
    : Math.min(variant.regenerationRetryCount ?? 0, MAX_REGENERATION_RETRIES);

  return {
    ...variant,
    caption: edits.caption ?? variant.caption,
    cta: edits.cta !== undefined ? edits.cta : variant.cta,
    hashtags: edits.hashtags ?? variant.hashtags,
    slides: edits.slides ?? variant.slides,
    humanEditTag: "human_edited",
    regenerationRetryCount: nextRetry,
  };
}

/**
 * Cap an existing retry count at MAX_REGENERATION_RETRIES (never exceed 3).
 */
export function clampRegenerationRetryCount(count: number): number {
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(Math.floor(count), MAX_REGENERATION_RETRIES);
}
