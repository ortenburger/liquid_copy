// Feature: content-creator-ai, Property 19: Post_Variant count per platform is always between 2 and 5
// Feature: content-creator-ai, Property 20: Post_Variant validation accepts exactly the correct structure
// Feature: content-creator-ai, Property 21: Human-edited variants are always tagged and retry count is bounded
import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  ContentAgent,
  clampVariantsPerPlatform,
  createOpenCarouselStubClient,
} from "../../src/lib/content-creator-ai/agents/content-agent/index.js";
import {
  applyHumanEdit,
  clampRegenerationRetryCount,
  MAX_REGENERATION_RETRIES,
  validatePostVariant,
} from "../../src/lib/content-creator-ai/agents/content-agent/variant-validation.js";
import type {
  Hypothesis,
  PostSlide,
  PostVariant,
  TraceabilityChain,
} from "../../src/lib/content-creator-ai/types/index.js";

function emptyTrace(id: string): TraceabilityChain {
  return {
    companyContextVersionId: "c",
    marketingGoalId: "g",
    audiencePersonaId: "a",
    roadmapEntryId: "r",
    hypothesisId: "h",
    postVariantId: id,
    status: "in_progress",
    links: [],
  };
}

const arbSlide: fc.Arbitrary<PostSlide> = fc.record({
  id: fc.uuid(),
  html: fc.string({ maxLength: 100 }),
  order: fc.nat({ max: 10 }),
  hasImage: fc.boolean(),
  hasText: fc.boolean(),
});

const arbVariantFields = fc.record({
  slides: fc.array(arbSlide, { minLength: 0, maxLength: 5 }),
  caption: fc.string({ maxLength: 200 }),
  cta: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
});

function makeHypothesis(): Hypothesis {
  return {
    id: "hyp-1",
    hook: "Stop scrolling",
    angle: "pain-first",
    coreCopy: "We help you ship faster",
    painPoint: "slow content",
    theme: "productivity",
    visualTheme: "bold sans",
    successMetrics: [
      {
        name: "engagement_rate",
        numericTarget: 0.05,
        timePeriod: "7d",
        direction: "increase",
      },
    ],
    roadmapEntryId: "re-1",
    goalId: "goal-1",
    status: "approved",
    kbStorageStatus: "persisted",
    createdAt: new Date().toISOString(),
    versions: [],
  };
}

describe("Property 19: Post_Variant count per platform is always between 2 and 5", () => {
  test("clampVariantsPerPlatform always returns [2,5]", () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 100, noNaN: true }), (n) => {
        const c = clampVariantsPerPlatform(n);
        return c >= 2 && c <= 5;
      }),
      { numRuns: 100 },
    );
  });

  test("ContentAgent generates between 2 and 5 variants per platform", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.constantFrom(
          "instagram",
          "tiktok",
          "linkedin",
          "x",
          "threads",
        ) as fc.Arbitrary<
          "instagram" | "tiktok" | "linkedin" | "x" | "threads"
        >,
        async (count, platform) => {
          const agent = new ContentAgent({
            openCarousel: createOpenCarouselStubClient(),
            variantsPerPlatform: count,
            ragUnavailable: true,
          });
          const result = await agent.generate(makeHypothesis(), [platform]);
          const forPlatform = result.variants.filter(
            (v) => v.platform === platform,
          );
          return forPlatform.length >= 2 && forPlatform.length <= 5;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 20: Post_Variant validation accepts exactly the correct structure", () => {
  test("valid iff ≥1 slide, every slide has image or text, caption non-empty; CTA irrelevant", () => {
    fc.assert(
      fc.property(arbVariantFields, (fields) => {
        const result = validatePostVariant(fields);
        const slidesOk =
          fields.slides.length >= 1 &&
          fields.slides.every(
            (s) =>
              s.hasImage === true ||
              s.hasText === true ||
              (typeof s.html === "string" && s.html.trim() !== ""),
          );
        const captionOk =
          typeof fields.caption === "string" && fields.caption.trim() !== "";
        const expected = slidesOk && captionOk;
        return result.valid === expected;
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 21: Human-edited variants are always tagged and retry count is bounded", () => {
  test("human edit tags variant and clamps retry count ≤ 3", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 20 }),
        fc.string({ maxLength: 50 }),
        fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
        (retryCount, caption, cta) => {
          const base: PostVariant = {
            id: "pv-1",
            hypothesisId: "h-1",
            platform: "instagram",
            carouselId: "c-1",
            slides: [
              {
                id: "s1",
                html: "<p>hi</p>",
                order: 0,
                hasImage: false,
                hasText: true,
              },
            ],
            caption: "original",
            hashtags: [],
            aspectRatio: "4:5",
            regenerationRetryCount: retryCount,
            validationStatus: "valid",
            status: "draft",
            traceability: emptyTrace("pv-1"),
          };
          const edited = applyHumanEdit(base, { caption, cta });
          expect(edited.humanEditTag).toBe("human_edited");
          expect(edited.regenerationRetryCount).toBeLessThanOrEqual(
            MAX_REGENERATION_RETRIES,
          );
          expect(edited.regenerationRetryCount).toBe(
            Math.min(retryCount + 1, MAX_REGENERATION_RETRIES),
          );
          expect(clampRegenerationRetryCount(retryCount + 100)).toBe(3);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
