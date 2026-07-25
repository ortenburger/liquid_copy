// Feature: content-creator-ai, Property 22: Outcome classification always matches the defined thresholds
// Feature: content-creator-ai, Property 23: Winner identification always uses engagement rate as primary comparator
import { describe, test, expect } from "vitest";
import fc from "fast-check";
import { classifyOutcome } from "../../src/lib/content-creator-ai/agents/learning-agent/classify.js";
import {
  computeSignificance,
  identifyWinner,
} from "../../src/lib/content-creator-ai/agents/analytics-agent/significance.js";
import type { ZernioMetrics } from "../../src/lib/content-creator-ai/types/index.js";

function metrics(engagementRate: number): ZernioMetrics {
  return {
    impressions: 1000,
    ctr: 0.1,
    saves: 10,
    shares: 5,
    comments: 3,
    watchTime: 100,
    conversions: 2,
    engagementRate,
    followerGrowth: 1,
  };
}

describe("Property 22: Outcome classification always matches the defined thresholds", () => {
  test("classifyOutcome matches all threshold boundaries", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 1e-6, max: 1000, noNaN: true }),
        (observed, target) => {
          const result = classifyOutcome(observed, target);
          if (observed > target * 1.2) return result === "exceeded_expectations";
          if (observed >= target * 0.8 && observed <= target * 1.2) {
            return result === "met_expectations";
          }
          if (observed >= target * 0.5 && observed < target * 0.8) {
            return result === "below_expectations";
          }
          return result === "failed";
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 23: Winner identification always uses engagement rate as primary comparator", () => {
  test("when significance is reached, winner has strictly highest engagementRate", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: 1, noNaN: true }), {
          minLength: 2,
          maxLength: 5,
        }),
        (rates) => {
          // Ensure a clear unique maximum so Welch's t-test can dominate
          const unique = rates.map((r, i) => r + i * 1e-9);
          const max = Math.max(...unique);
          const pairs = unique.map((engagementRate, i) => ({
            postVariantId: `v${i}`,
            metrics: metrics(engagementRate),
          }));

          const result = identifyWinner("exp-1", pairs, {
            observationWindowExpired: true,
            sampleSize: 40,
          });

          if (!result.conclusive || !result.result) {
            // Inconclusive is allowed when samples aren't separable —
            // but if conclusive, winner must be highest engagementRate
            return true;
          }

          const winnerId = result.result.winningVariantId;
          const winnerRate = pairs.find(
            (p) => p.postVariantId === winnerId,
          )!.metrics.engagementRate;
          const isMax = winnerRate === max;
          const methodOk =
            result.result.determinationMethod === "statistically_significant" ||
            result.result.determinationMethod === "highest_absolute";
          return isMax && methodOk;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("computeSignificance ranks by mean engagement rate", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            postVariantId: fc.uuid(),
            engagementRates: fc.array(
              fc.double({ min: 0, max: 1, noNaN: true }),
              { minLength: 5, maxLength: 20 },
            ),
          }),
          { minLength: 2, maxLength: 4 },
        ),
        (variants) => {
          // Deduplicate ids
          const seen = new Set<string>();
          const unique = variants.filter((v) => {
            if (seen.has(v.postVariantId)) return false;
            seen.add(v.postVariantId);
            return true;
          });
          if (unique.length < 2) return true;

          const result = computeSignificance({
            experimentId: "e1",
            variants: unique,
            observationWindowExpired: true,
          });
          if (!result.result) return true;

          const mean = (xs: number[]) =>
            xs.reduce((s, x) => s + x, 0) / xs.length;
          const winner = unique.find(
            (v) => v.postVariantId === result.result!.winningVariantId,
          )!;
          const winnerMean = mean(winner.engagementRates);
          return unique.every((v) => mean(v.engagementRates) <= winnerMean + 1e-12);
        },
      ),
      { numRuns: 100 },
    );
  });
});
