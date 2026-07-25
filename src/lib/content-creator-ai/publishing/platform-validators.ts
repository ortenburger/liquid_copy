import type { AspectRatio, PostVariant, SocialPlatform } from "../types/index.js";

/** Structured constraint violation for a platform. */
export interface PlatformViolation {
  code:
    | "aspect_ratio"
    | "caption_length"
    | "hashtag_count"
    | "cta_placement";
  message: string;
  actual?: string | number;
  expected?: string | number;
}

export interface PlatformValidationResult {
  platform: SocialPlatform;
  valid: boolean;
  violations: PlatformViolation[];
}

export interface MultiPlatformValidationResult {
  results: PlatformValidationResult[];
  /** True when ≥ 1 selected platform passes (Req 5.5). */
  canAdvance: boolean;
  /** True when no platforms were selected (Req 5.4). */
  noPlatformSelected: boolean;
}

export interface PlatformConstraints {
  platform: SocialPlatform;
  /** Allowed aspect ratios for this platform. */
  aspectRatios: AspectRatio[];
  /** Maximum caption length in characters. */
  captionLimit: number;
  /** Maximum hashtag count; null = no limit / N/A. */
  hashtagLimit: number | null;
  /**
   * CTA placement rule:
   * - "optional" — CTA may be present or absent
   * - "in_caption" — if CTA is present it must appear in the caption text
   * - "none" — CTA must not be present as a separate field (Etsy)
   */
  ctaRule: "optional" | "in_caption" | "none";
}

/** Platform constraint table from design / tasklist_3. */
export const PLATFORM_CONSTRAINTS: Record<SocialPlatform, PlatformConstraints> = {
  instagram: {
    platform: "instagram",
    aspectRatios: ["4:5"],
    captionLimit: 2200,
    hashtagLimit: 30,
    ctaRule: "optional",
  },
  tiktok: {
    platform: "tiktok",
    aspectRatios: ["9:16"],
    captionLimit: 2200,
    hashtagLimit: 30,
    ctaRule: "optional",
  },
  linkedin: {
    platform: "linkedin",
    aspectRatios: ["1:1", "4:5"],
    captionLimit: 3000,
    hashtagLimit: 30,
    ctaRule: "optional",
  },
  facebook: {
    platform: "facebook",
    aspectRatios: ["1:1", "4:5"],
    captionLimit: 63206,
    hashtagLimit: null,
    ctaRule: "optional",
  },
  pinterest: {
    platform: "pinterest",
    aspectRatios: ["4:5", "2:3"],
    captionLimit: 500,
    hashtagLimit: null,
    ctaRule: "optional",
  },
  etsy: {
    platform: "etsy",
    aspectRatios: ["1:1"],
    captionLimit: 300,
    hashtagLimit: null,
    ctaRule: "none",
  },
  x: {
    platform: "x",
    aspectRatios: ["1:1", "16:9"],
    captionLimit: 280,
    hashtagLimit: 10,
    ctaRule: "in_caption",
  },
  threads: {
    platform: "threads",
    aspectRatios: ["1:1"],
    captionLimit: 500,
    hashtagLimit: 10,
    ctaRule: "optional",
  },
  youtube_shorts: {
    platform: "youtube_shorts",
    aspectRatios: ["9:16"],
    captionLimit: 5000,
    hashtagLimit: 15,
    ctaRule: "optional",
  },
};

/** Map each SocialPlatform to its primary (recommended) aspect ratio. */
export function aspectRatioForPlatform(platform: SocialPlatform): AspectRatio {
  return PLATFORM_CONSTRAINTS[platform].aspectRatios[0];
}

export function getPlatformConstraints(
  platform: SocialPlatform,
): PlatformConstraints {
  return PLATFORM_CONSTRAINTS[platform];
}

/**
 * Validate a single content payload against one platform's constraints.
 * Flags aspect ratio, caption length, hashtag count, and CTA placement.
 * Property 14 / Requirement 5.3.
 */
export function validatePlatformContent(
  content: {
    aspectRatio: AspectRatio;
    caption: string;
    hashtags: string[];
    cta?: string;
  },
  platform: SocialPlatform,
): PlatformValidationResult {
  const constraints = PLATFORM_CONSTRAINTS[platform];
  const violations: PlatformViolation[] = [];

  if (!constraints.aspectRatios.includes(content.aspectRatio)) {
    violations.push({
      code: "aspect_ratio",
      message: `Aspect ratio ${content.aspectRatio} is not allowed for ${platform}`,
      actual: content.aspectRatio,
      expected: constraints.aspectRatios.join(" | "),
    });
  }

  if (content.caption.length > constraints.captionLimit) {
    violations.push({
      code: "caption_length",
      message: `Caption length ${content.caption.length} exceeds ${platform} limit of ${constraints.captionLimit}`,
      actual: content.caption.length,
      expected: constraints.captionLimit,
    });
  }

  if (
    constraints.hashtagLimit !== null &&
    content.hashtags.length > constraints.hashtagLimit
  ) {
    violations.push({
      code: "hashtag_count",
      message: `Hashtag count ${content.hashtags.length} exceeds ${platform} limit of ${constraints.hashtagLimit}`,
      actual: content.hashtags.length,
      expected: constraints.hashtagLimit,
    });
  }

  const ctaPresent =
    content.cta !== undefined && content.cta !== null && content.cta.trim() !== "";

  if (constraints.ctaRule === "none" && ctaPresent) {
    violations.push({
      code: "cta_placement",
      message: `${platform} does not support a separate CTA field`,
      actual: content.cta,
      expected: "none",
    });
  }

  if (constraints.ctaRule === "in_caption" && ctaPresent) {
    const captionIncludesCta = content.caption.includes(content.cta!.trim());
    if (!captionIncludesCta) {
      violations.push({
        code: "cta_placement",
        message: `CTA for ${platform} must appear within the caption text`,
        actual: content.cta,
        expected: "in_caption",
      });
    }
  }

  return {
    platform,
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Validate a PostVariant against its own platform.
 */
export function validatePostVariantForPlatform(
  variant: PostVariant,
): PlatformValidationResult {
  return validatePlatformContent(
    {
      aspectRatio: variant.aspectRatio,
      caption: variant.caption,
      hashtags: variant.hashtags,
      cta: variant.cta,
    },
    variant.platform,
  );
}

/**
 * Validate content across selected platforms.
 * - No platforms selected → cannot advance (Req 5.4)
 * - ≥ 1 platform passes → can advance (Req 5.5)
 * - All selected platforms fail → cannot advance (Req 5.5)
 */
export function validateSelectedPlatforms(
  content: {
    aspectRatio: AspectRatio;
    caption: string;
    hashtags: string[];
    cta?: string;
  },
  selectedPlatforms: SocialPlatform[],
): MultiPlatformValidationResult {
  if (selectedPlatforms.length === 0) {
    return {
      results: [],
      canAdvance: false,
      noPlatformSelected: true,
    };
  }

  const results = selectedPlatforms.map((p) =>
    validatePlatformContent(content, p),
  );
  const canAdvance = results.some((r) => r.valid);

  return {
    results,
    canAdvance,
    noPlatformSelected: false,
  };
}

/** All nine supported publishing channels. */
export const SUPPORTED_PLATFORMS: SocialPlatform[] = [
  "instagram",
  "tiktok",
  "linkedin",
  "facebook",
  "pinterest",
  "etsy",
  "x",
  "threads",
  "youtube_shorts",
];
