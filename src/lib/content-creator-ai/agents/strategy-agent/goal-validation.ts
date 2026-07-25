/**
 * Marketing goal validation (Task 6.1) — Requirements 3.1, 3.4, 3.5, 3.6, 3.7.
 *
 * Two validators, because the spec asks for two different bars:
 *
 * - `validateGoal` — what Requirements 3.4/3.5/3.6 gate user-supplied goals on:
 *   a non-empty `primaryObjective` and at least one `SuccessMetric` carrying a
 *   `numericTarget` and a `timePeriod`. Property 9 states this as an "if and
 *   only if", so nothing else may affect the verdict here.
 * - `validateGeneratedGoal` — additionally requires `targetPlatform`, which
 *   Requirement 3.1 and Property 8 demand of goals the Strategy_Agent *emits*.
 *
 * Keeping them separate is deliberate: folding the platform check into
 * `validateGoal` would contradict Property 9's iff, and dropping it entirely
 * would contradict Requirement 3.1.
 */
import type { MarketingGoal, SuccessMetric } from "../../types/index.js";
import type { SocialPlatform } from "../../types/enums.js";

export interface GoalValidationResult {
  valid: boolean;
  missingFields: string[];
}

export const SUPPORTED_PLATFORMS: readonly SocialPlatform[] = [
  "instagram", "tiktok", "linkedin", "facebook", "pinterest",
  "etsy", "x", "threads", "youtube_shorts",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A metric is measurable when it names an indicator, targets a finite number and
 * scopes that target to a time period.
 */
export function isMeasurableMetric(metric: unknown): metric is SuccessMetric {
  if (typeof metric !== "object" || metric === null) return false;
  const m = metric as Partial<SuccessMetric>;
  return (
    isNonEmptyString(m.name) &&
    typeof m.numericTarget === "number" &&
    Number.isFinite(m.numericTarget) &&
    isNonEmptyString(m.timePeriod)
  );
}

export function isSupportedPlatform(value: unknown): value is SocialPlatform {
  return (
    typeof value === "string" &&
    (SUPPORTED_PLATFORMS as readonly string[]).includes(value)
  );
}

/**
 * Validate a user-supplied or modified goal (Requirements 3.4, 3.5, 3.6).
 * Valid iff `primaryObjective` is non-empty AND at least one measurable metric
 * is present — see Property 9.
 */
export function validateGoal(goal: unknown): GoalValidationResult {
  const missingFields: string[] = [];
  const g = (goal ?? {}) as Partial<MarketingGoal>;

  if (!isNonEmptyString(g.primaryObjective)) missingFields.push("primaryObjective");

  const metrics = Array.isArray(g.successMetrics) ? g.successMetrics : [];
  if (!metrics.some(isMeasurableMetric)) {
    // Requirement 3.6: the operator must add at least one quantifiable metric.
    missingFields.push("successMetrics");
  }

  return { valid: missingFields.length === 0, missingFields };
}

/**
 * Validate a goal the Strategy_Agent generated or is about to store as active
 * (Requirement 3.1 / Property 8): everything `validateGoal` requires, plus a
 * supported target platform.
 */
export function validateGeneratedGoal(goal: unknown): GoalValidationResult {
  const base = validateGoal(goal);
  const missingFields = [...base.missingFields];
  const g = (goal ?? {}) as Partial<MarketingGoal>;
  if (!isSupportedPlatform(g.targetPlatform)) missingFields.push("targetPlatform");
  return { valid: missingFields.length === 0, missingFields };
}

/** Human-readable prompt naming what the operator still needs to supply. */
export function describeMissingFields(result: GoalValidationResult): string {
  if (result.valid) return "";
  const labels: Record<string, string> = {
    primaryObjective: "a primary objective",
    successMetrics:
      "at least one quantifiable success metric with a numeric target and a time period",
    targetPlatform: "a target platform",
  };
  const parts = result.missingFields.map((f) => labels[f] ?? f);
  return `Please add ${parts.join(" and ")} before proceeding.`;
}

// ---- Company context sufficiency (Requirement 3.7) ----

export interface ContextSufficiency {
  sufficient: boolean;
  missing: string[];
  message: string;
}

/**
 * Goal generation requires the KB to hold, at minimum, a company name, an
 * industry and at least one business objective (Requirement 3.1 precondition).
 * When it does not, Requirement 3.7 says notify rather than generate.
 */
export function assessCompanyContext(identity: unknown): ContextSufficiency {
  const missing: string[] = [];
  const c = (identity ?? {}) as {
    name?: unknown;
    industry?: unknown;
    businessObjectives?: unknown;
  };

  if (!isNonEmptyString(c.name)) missing.push("company name");
  if (!isNonEmptyString(c.industry)) missing.push("industry");
  const objectives = Array.isArray(c.businessObjectives)
    ? c.businessObjectives.filter(isNonEmptyString)
    : [];
  if (objectives.length === 0) missing.push("at least one business objective");

  return {
    sufficient: missing.length === 0,
    missing,
    message:
      missing.length === 0
        ? ""
        : `Company context must be completed before goal generation can proceed. Missing: ${missing.join(", ")}.`,
  };
}
