import type { PostVariantOutcome } from "../../types/index.js";

export type OutcomeClassification = PostVariantOutcome["classification"];

/**
 * Classify observed vs target using defined thresholds.
 * Property 22 / Requirement 11.2:
 * - exceeded_expectations: observed > target × 1.20
 * - met_expectations: target × 0.80 ≤ observed ≤ target × 1.20
 * - below_expectations: target × 0.50 ≤ observed < target × 0.80
 * - failed: observed < target × 0.50
 */
export function classifyOutcome(
  observed: number,
  target: number,
): OutcomeClassification {
  if (!Number.isFinite(observed) || !Number.isFinite(target) || target === 0) {
    // Degenerate target: treat non-positive/NaN target as failed unless observed is also 0
    if (target === 0) {
      if (observed > 0) return "exceeded_expectations";
      return "met_expectations";
    }
    return "failed";
  }

  if (observed > target * 1.2) return "exceeded_expectations";
  if (observed >= target * 0.8 && observed <= target * 1.2) {
    return "met_expectations";
  }
  if (observed >= target * 0.5 && observed < target * 0.8) {
    return "below_expectations";
  }
  return "failed";
}

export function classifyPostVariantOutcome(
  postVariantId: string,
  observedValue: number,
  targetValue: number,
): PostVariantOutcome {
  return {
    postVariantId,
    classification: classifyOutcome(observedValue, targetValue),
    observedValue,
    targetValue,
  };
}
