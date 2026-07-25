// Feature: content-creator-ai, Property 14: Platform content validation flags all constraint violations
import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  PLATFORM_CONSTRAINTS,
  SUPPORTED_PLATFORMS,
  validatePlatformContent,
  validateSelectedPlatforms,
} from "../../src/lib/content-creator-ai/publishing/platform-validators.js";
import type { AspectRatio, SocialPlatform } from "../../src/lib/content-creator-ai/types/index.js";

const aspectRatios: AspectRatio[] = ["1:1", "4:5", "9:16", "16:9", "2:3"];

const arbPlatform = fc.constantFrom(...SUPPORTED_PLATFORMS);

const arbContent = fc.record({
  aspectRatio: fc.constantFrom(...aspectRatios),
  caption: fc.string({ maxLength: 1000 }),
  hashtags: fc.array(fc.stringMatching(/^[a-zA-Z0-9_]{1,20}$/), {
    maxLength: 40,
  }),
  cta: fc.option(fc.string({ maxLength: 80 }), { nil: undefined }),
});

function expectedViolations(
  content: {
    aspectRatio: AspectRatio;
    caption: string;
    hashtags: string[];
    cta?: string;
  },
  platform: SocialPlatform,
): Set<"aspect_ratio" | "caption_length" | "hashtag_count" | "cta_placement"> {
  const c = PLATFORM_CONSTRAINTS[platform];
  const codes = new Set<
    "aspect_ratio" | "caption_length" | "hashtag_count" | "cta_placement"
  >();
  if (!c.aspectRatios.includes(content.aspectRatio)) codes.add("aspect_ratio");
  if (content.caption.length > c.captionLimit) codes.add("caption_length");
  if (c.hashtagLimit !== null && content.hashtags.length > c.hashtagLimit) {
    codes.add("hashtag_count");
  }
  const ctaPresent =
    content.cta !== undefined && content.cta !== null && content.cta.trim() !== "";
  if (c.ctaRule === "none" && ctaPresent) codes.add("cta_placement");
  if (
    c.ctaRule === "in_caption" &&
    ctaPresent &&
    !content.caption.includes(content.cta!.trim())
  ) {
    codes.add("cta_placement");
  }
  return codes;
}

describe("Property 14: Platform content validation", () => {
  test("flags content iff at least one constraint violation is present", () => {
    fc.assert(
      fc.property(arbContent, arbPlatform, (content, platform) => {
        const result = validatePlatformContent(content, platform);
        const expected = expectedViolations(content, platform);
        const actual = new Set(result.violations.map((v) => v.code));

        // Flagged iff expected non-empty
        if (expected.size === 0) {
          return result.valid === true && actual.size === 0;
        }
        if (result.valid) return false;
        // Every actual violation must be in expected; every expected must be flagged
        for (const code of actual) {
          if (!expected.has(code)) return false;
        }
        for (const code of expected) {
          if (!actual.has(code)) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  test("canAdvance is true iff at least one selected platform passes", () => {
    fc.assert(
      fc.property(
        arbContent,
        fc.array(arbPlatform, { minLength: 0, maxLength: 5 }),
        (content, platforms) => {
          const unique = [...new Set(platforms)];
          const result = validateSelectedPlatforms(content, unique);
          if (unique.length === 0) {
            return result.canAdvance === false && result.noPlatformSelected === true;
          }
          const anyPass = result.results.some((r) => r.valid);
          return result.canAdvance === anyPass && result.noPlatformSelected === false;
        },
      ),
      { numRuns: 100 },
    );
  });
});
