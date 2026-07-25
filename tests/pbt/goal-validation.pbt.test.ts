// Feature: content-creator-ai, Property 8: Generated goals always include objective, platform, and at least one measurable metric
// Feature: content-creator-ai, Property 9: Goal validation rejects any goal missing required fields
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import type {
  CompanyIdentity,
  MarketingGoal,
  Product,
  SuccessMetric,
} from "@/lib/content-creator-ai/types/index.js";
import type { SocialPlatform } from "@/lib/content-creator-ai/types/enums.js";
import {
  validateGoal,
  validateGeneratedGoal,
  assessCompanyContext,
  SUPPORTED_PLATFORMS,
} from "@/lib/content-creator-ai/agents/strategy-agent/goal-validation.js";
import { generateMarketingGoal } from "@/lib/content-creator-ai/agents/strategy-agent/goals.js";
import {
  setLLMClient,
  resetLLMClient,
  UnavailableLLMClient,
  ScriptedLLMClient,
} from "@/lib/content-creator-ai/integrations/llm.js";

const nonEmptyString = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

/** Strings that must NOT satisfy a "non-empty" check. */
const blankString = fc.constantFrom("", " ", "   ", "\t", "\n", "  \n ");

const platformArb = fc.constantFrom(...SUPPORTED_PLATFORMS);

const measurableMetricArb: fc.Arbitrary<SuccessMetric> = fc.record({
  name: nonEmptyString,
  numericTarget: fc.double({
    min: -1e6,
    max: 1e6,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  timePeriod: nonEmptyString,
  direction: fc.constantFrom(
    "increase" as const,
    "decrease" as const,
    "maintain" as const,
  ),
});

/** Metrics broken in exactly one way, so none of them is measurable. */
const brokenMetricArb = fc.oneof(
  fc.record({
    name: blankString,
    numericTarget: fc.double({ min: 0, max: 100, noNaN: true }),
    timePeriod: nonEmptyString,
    direction: fc.constant("increase" as const),
  }),
  fc.record({
    name: nonEmptyString,
    numericTarget: fc.double({ min: 0, max: 100, noNaN: true }),
    timePeriod: blankString,
    direction: fc.constant("increase" as const),
  }),
  fc.record({
    name: nonEmptyString,
    numericTarget: fc.constantFrom(NaN, Infinity, -Infinity),
    timePeriod: nonEmptyString,
    direction: fc.constant("increase" as const),
  }),
) as fc.Arbitrary<SuccessMetric>;

function makeGoal(
  primaryObjective: string,
  successMetrics: SuccessMetric[],
  targetPlatform: SocialPlatform = "instagram",
): MarketingGoal {
  return {
    id: "goal-1",
    primaryObjective,
    targetPlatform,
    successMetrics,
    status: "proposed",
    kbVersion: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const identityArb: fc.Arbitrary<CompanyIdentity> = fc.record({
  id: nonEmptyString,
  name: nonEmptyString,
  industry: nonEmptyString,
  mission: nonEmptyString,
  brandVoice: nonEmptyString,
  values: fc.array(nonEmptyString, { maxLength: 3 }),
  products: fc.constant([] as Product[]),
  features: fc.array(nonEmptyString, { maxLength: 3 }),
  benefits: fc.array(nonEmptyString, { maxLength: 3 }),
  businessObjectives: fc.array(nonEmptyString, { minLength: 1, maxLength: 3 }),
});

describe("Goal validation property tests", () => {
  beforeEach(() => {
    // Deterministic: exercise the derived-defaults path, never a live model.
    setLLMClient(new UnavailableLLMClient());
  });

  afterEach(() => {
    resetLLMClient();
  });

  // Feature: content-creator-ai, Property 9: Goal validation rejects any goal missing required fields
  test("Property 9: valid iff non-empty objective AND >= 1 measurable metric", () => {
    fc.assert(
      fc.property(
        fc.oneof(nonEmptyString, blankString),
        fc.array(fc.oneof(measurableMetricArb, brokenMetricArb), {
          maxLength: 5,
        }),
        platformArb,
        (objective, metrics, platform) => {
          const goal = makeGoal(objective, metrics, platform);
          const result = validateGoal(goal);

          // Independent restatement of the rule, not a call back into the impl.
          const objectiveOk = objective.trim().length > 0;
          const metricOk = metrics.some(
            (m) =>
              typeof m.name === "string" &&
              m.name.trim().length > 0 &&
              typeof m.numericTarget === "number" &&
              Number.isFinite(m.numericTarget) &&
              typeof m.timePeriod === "string" &&
              m.timePeriod.trim().length > 0,
          );
          const expected = objectiveOk && metricOk;

          if (result.valid !== expected) return false;
          if (
            !objectiveOk &&
            !result.missingFields.includes("primaryObjective")
          ) {
            return false;
          }
          if (!metricOk && !result.missingFields.includes("successMetrics")) {
            return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 9: a goal with no metrics at all is always invalid", () => {
    fc.assert(
      fc.property(nonEmptyString, (objective) => {
        const result = validateGoal(makeGoal(objective, []));
        return !result.valid && result.missingFields.includes("successMetrics");
      }),
      { numRuns: 100 },
    );
  });

  test("Property 9: an unsupported platform does not affect validateGoal", () => {
    // Requirements 3.4-3.6 gate on objective + metric only; the platform bar
    // lives in validateGeneratedGoal (Requirement 3.1).
    const goal = {
      ...makeGoal("Grow reach", [
        {
          name: "ctr",
          numericTarget: 3,
          timePeriod: "30d",
          direction: "increase" as const,
        },
      ]),
      targetPlatform: "myspace" as unknown as SocialPlatform,
    };
    expect(validateGoal(goal).valid).toBe(true);
    expect(validateGeneratedGoal(goal).valid).toBe(false);
    expect(validateGeneratedGoal(goal).missingFields).toContain(
      "targetPlatform",
    );
  });

  // Feature: content-creator-ai, Property 8: Generated goals always include objective, platform, and at least one measurable metric
  test("Property 8: generated goals are always complete for sufficient context", async () => {
    await fc.assert(
      fc.asyncProperty(identityArb, async (identity) => {
        const result = await generateMarketingGoal({
          identity,
          skipGrounding: true,
        });

        if (!result.contextSufficiency.sufficient) return false;
        const goal = result.goal;
        if (!goal) return false;

        if (goal.primaryObjective.trim().length === 0) return false;
        if (
          !(SUPPORTED_PLATFORMS as readonly string[]).includes(
            goal.targetPlatform,
          )
        ) {
          return false;
        }
        const hasMeasurable = goal.successMetrics.some(
          (m) =>
            m.name.trim().length > 0 &&
            Number.isFinite(m.numericTarget) &&
            m.timePeriod.trim().length > 0,
        );
        if (!hasMeasurable) return false;

        // The generator's own gate must agree.
        return validateGeneratedGoal(goal).valid;
      }),
      { numRuns: 100 },
    );
  });

  test("Property 8 holds when the model returns unusable JSON", async () => {
    setLLMClient(
      new ScriptedLLMClient([
        '{"primaryObjective": "", "targetPlatform": "myspace", "successMetrics": [{"name": "", "numericTarget": "abc"}]}',
      ]),
    );

    const result = await generateMarketingGoal({
      identity: {
        id: "acme",
        name: "Acme",
        industry: "SaaS",
        mission: "Ship faster",
        brandVoice: "direct",
        values: [],
        products: [],
        features: [],
        benefits: [],
        businessObjectives: ["Grow trial signups"],
      },
      skipGrounding: true,
    });

    expect(result.goal).toBeDefined();
    expect(validateGeneratedGoal(result.goal!).valid).toBe(true);
    // Model-supplied junk was discarded in favour of the derived objective.
    expect(result.goal!.primaryObjective).toBe("Grow trial signups");
  });

  test("Requirement 3.7: insufficient context yields no goal and a message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.oneof(nonEmptyString, blankString),
          industry: fc.oneof(nonEmptyString, blankString),
          businessObjectives: fc.array(nonEmptyString, { maxLength: 2 }),
        }),
        async (partial) => {
          const identity = {
            id: "x",
            mission: "m",
            brandVoice: "v",
            values: [],
            products: [],
            features: [],
            benefits: [],
            ...partial,
          } as CompanyIdentity;

          const sufficiency = assessCompanyContext(identity);
          const result = await generateMarketingGoal({
            identity,
            skipGrounding: true,
          });

          if (sufficiency.sufficient) return result.goal !== undefined;
          // Requirement 3.7: notify, do not generate.
          return (
            result.goal === undefined &&
            result.contextSufficiency.message.length > 0 &&
            result.contextSufficiency.missing.length > 0
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
