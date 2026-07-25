// Feature: content-creator-ai, Property 10: Proposed persona sets are distinct (<60% pairwise overlap)
// Feature: content-creator-ai, Property 11: Persona validation rejects submissions missing required fields
// Feature: content-creator-ai, Property 12: Persona overlap alert fires exactly when overlap >= 60%
// Feature: content-creator-ai, Property 13: Merged persona is the union of unique fields from both sources
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import type {
  AudiencePersona,
  MarketingGoal,
} from "@/lib/content-creator-ai/types/index.js";
import { validatePersona } from "@/lib/content-creator-ai/agents/audience-agent/persona-validation.js";
import {
  OVERLAP_THRESHOLD,
  PERSONA_CONTENT_FIELDS,
  computePairwiseOverlap,
  jaccardSimilarity,
  mergePersonas,
  shouldAlertOverlap,
} from "@/lib/content-creator-ai/agents/audience-agent/overlap.js";
import {
  AudienceAgent,
  MAX_PERSONAS,
  MIN_PERSONAS,
} from "@/lib/content-creator-ai/agents/audience-agent/index.js";
import {
  setLLMClient,
  resetLLMClient,
  UnavailableLLMClient,
  ScriptedLLMClient,
} from "@/lib/content-creator-ai/integrations/llm.js";
import { eventBus } from "@/lib/content-creator-ai/orchestration/event-bus.js";

const nonEmptyString = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

const blankString = fc.constantFrom("", " ", "  ", "\t", "\n");

/**
 * Small value pool so generated personas actually overlap often enough to
 * exercise both sides of Property 12's "if and only if".
 */
const pooledValue = fc.constantFrom(
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
);

const personaArb: fc.Arbitrary<AudiencePersona> = fc.record({
  id: fc.uuid(),
  icpDefinition: pooledValue,
  painPoints: fc.array(pooledValue, { minLength: 1, maxLength: 4 }),
  jobsToBeDone: fc.array(pooledValue, { maxLength: 3 }),
  objections: fc.array(pooledValue, { maxLength: 3 }),
  dreamOutcomes: fc.array(pooledValue, { maxLength: 3 }),
  source: fc.constantFrom(
    "ai_generated" as const,
    "user_created" as const,
    "merged" as const,
  ),
  kbVersion: fc.constant("v1"),
  createdAt: fc.constant("2026-01-01T00:00:00.000Z"),
});

/** Recompute Jaccard independently of the implementation under test. */
function independentJaccard(
  a: Partial<AudiencePersona>,
  b: Partial<AudiencePersona>,
): number {
  const norm = (s: string): string =>
    s.trim().toLowerCase().replace(/\s+/g, " ");
  const toSet = (p: Partial<AudiencePersona>): Set<string> => {
    const values = new Set<string>();
    for (const field of PERSONA_CONTENT_FIELDS) {
      const raw = p[field];
      if (typeof raw === "string") {
        if (norm(raw)) values.add(`${field}:${norm(raw)}`);
      } else if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === "string" && norm(item)) {
            values.add(`${field}:${norm(item)}`);
          }
        }
      }
    }
    return values;
  };

  const setA = toSet(a);
  const setB = toSet(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const v of setA) if (setB.has(v)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

const goal: MarketingGoal = {
  id: "goal-1",
  primaryObjective: "Grow qualified trial signups",
  targetPlatform: "linkedin",
  successMetrics: [
    {
      name: "engagement_rate",
      numericTarget: 5,
      timePeriod: "30d",
      direction: "increase",
    },
  ],
  status: "accepted",
  kbVersion: "v1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Persona property tests", () => {
  beforeEach(() => {
    setLLMClient(new UnavailableLLMClient());
    eventBus.clear();
  });

  afterEach(() => {
    resetLLMClient();
    eventBus.clear();
  });

  // Feature: content-creator-ai, Property 11: Persona validation rejects submissions missing required fields
  test("Property 11: valid iff non-empty icpDefinition AND >= 1 pain point", () => {
    fc.assert(
      fc.property(
        fc.oneof(nonEmptyString, blankString),
        fc.array(fc.oneof(nonEmptyString, blankString), { maxLength: 4 }),
        (icpDefinition, painPoints) => {
          const result = validatePersona({ icpDefinition, painPoints });

          const icpOk = icpDefinition.trim().length > 0;
          const painOk = painPoints.some((p) => p.trim().length > 0);
          const expected = icpOk && painOk;

          if (result.valid !== expected) return false;
          if (!icpOk && !result.missingFields.includes("icpDefinition")) {
            return false;
          }
          if (!painOk && !result.missingFields.includes("painPoints")) {
            return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 11: missing fields are named for the operator", () => {
    const result = validatePersona({ icpDefinition: "", painPoints: [] });
    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual(["icpDefinition", "painPoints"]);
  });

  // Feature: content-creator-ai, Property 12: Persona overlap alert fires exactly when overlap >= 60%
  test("Property 12: alert fires iff similarity >= 0.6", () => {
    fc.assert(
      fc.property(personaArb, personaArb, (a, b) => {
        const expected = independentJaccard(a, b) >= OVERLAP_THRESHOLD;
        if (shouldAlertOverlap(a, b) !== expected) return false;
        // The pairwise report must agree with the pairwise predicate.
        const pairs = computePairwiseOverlap([a, b]);
        return pairs.length === 1 && pairs[0].alert === expected;
      }),
      { numRuns: 100 },
    );
  });

  test("Property 12: identical personas alert; disjoint personas do not", () => {
    const base: AudiencePersona = {
      id: "a",
      icpDefinition: "founders",
      painPoints: ["no time"],
      jobsToBeDone: ["ship faster"],
      objections: ["cost"],
      dreamOutcomes: ["growth"],
      source: "ai_generated",
      kbVersion: "v1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(jaccardSimilarity(base, { ...base, id: "b" })).toBe(1);
    expect(shouldAlertOverlap(base, { ...base, id: "b" })).toBe(true);

    const disjoint: AudiencePersona = {
      ...base,
      id: "c",
      icpDefinition: "enterprise buyers",
      painPoints: ["procurement delays"],
      jobsToBeDone: ["win internal approval"],
      objections: ["security review"],
      dreamOutcomes: ["board sign-off"],
    };
    expect(jaccardSimilarity(base, disjoint)).toBe(0);
    expect(shouldAlertOverlap(base, disjoint)).toBe(false);
  });

  test("Property 12: two empty personas score 0 rather than 1", () => {
    // Documented convention: no content means no evidence of overlap.
    expect(jaccardSimilarity({}, {})).toBe(0);
    expect(shouldAlertOverlap({}, {})).toBe(false);
  });

  // Feature: content-creator-ai, Property 13: Merged persona is the union of unique fields from both sources
  test("Property 13: merge is the union of both sources and stays valid", () => {
    fc.assert(
      fc.property(personaArb, personaArb, (a, b) => {
        const { merged, sourceIds, validation } = mergePersonas(a, b);

        // Both source ICP texts must survive.
        if (!merged.icpDefinition.includes(a.icpDefinition.trim())) return false;
        if (!merged.icpDefinition.includes(b.icpDefinition.trim())) return false;

        const listFields = [
          "painPoints",
          "jobsToBeDone",
          "objections",
          "dreamOutcomes",
        ] as const;
        for (const field of listFields) {
          const mergedLower = merged[field].map((v) => v.toLowerCase());
          for (const source of [a, b]) {
            for (const value of source[field]) {
              if (!value.trim()) continue;
              if (!mergedLower.includes(value.trim().toLowerCase())) return false;
            }
          }
          // No duplicates in the union.
          if (new Set(mergedLower).size !== mergedLower.length) return false;
        }

        if (merged.source !== "merged") return false;
        if (sourceIds[0] !== a.id || sourceIds[1] !== b.id) return false;
        // Both sources are valid by construction, so the union must be too.
        return validation.valid && validatePersona(merged).valid;
      }),
      { numRuns: 100 },
    );
  });

  test("Property 13: merging keeps a single copy of a shared value", () => {
    const a: AudiencePersona = {
      id: "a",
      icpDefinition: "founders",
      painPoints: ["no time", "no budget"],
      jobsToBeDone: [],
      objections: [],
      dreamOutcomes: [],
      source: "ai_generated",
      kbVersion: "v1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const b: AudiencePersona = {
      ...a,
      id: "b",
      painPoints: ["No Time", "no team"],
    };

    const { merged } = mergePersonas(a, b);
    expect(merged.painPoints).toEqual(["no time", "no budget", "no team"]);
    // Identical ICP text is not duplicated.
    expect(merged.icpDefinition).toBe("founders");
  });

  // Feature: content-creator-ai, Property 10: Proposed persona sets are distinct (<60% pairwise overlap)
  test("Property 10: proposed sets hold 2-5 personas, all pairs below 0.6", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (requestedCount) => {
        const agent = new AudienceAgent();
        const result = await agent.proposePersonas({
          goal,
          count: requestedCount,
          skipGrounding: true,
        });

        if (result.personas.length < MIN_PERSONAS) return false;
        if (result.personas.length > MAX_PERSONAS) return false;

        for (let i = 0; i < result.personas.length; i++) {
          for (let j = i + 1; j < result.personas.length; j++) {
            if (
              independentJaccard(result.personas[i], result.personas[j]) >=
              OVERLAP_THRESHOLD
            ) {
              return false;
            }
          }
        }

        if (!result.personas.every((p) => validatePersona(p).valid)) return false;
        return result.distinct === true;
      }),
      { numRuns: 100 },
    );
  });

  test("Property 10 holds when the model proposes near-identical personas", async () => {
    // Three personas sharing every field: only one may be admitted, and the set
    // must still be topped up to at least two distinct entries.
    const duplicate = {
      icpDefinition: "founders",
      painPoints: ["no time"],
      jobsToBeDone: ["ship"],
      objections: ["cost"],
      dreamOutcomes: ["growth"],
    };
    setLLMClient(
      new ScriptedLLMClient([JSON.stringify([duplicate, duplicate, duplicate])]),
    );

    const agent = new AudienceAgent();
    const result = await agent.proposePersonas({
      goal,
      count: 3,
      skipGrounding: true,
    });

    expect(result.personas.length).toBeGreaterThanOrEqual(MIN_PERSONAS);
    expect(result.distinct).toBe(true);
    for (let i = 0; i < result.personas.length; i++) {
      for (let j = i + 1; j < result.personas.length; j++) {
        expect(
          independentJaccard(result.personas[i], result.personas[j]),
        ).toBeLessThan(OVERLAP_THRESHOLD);
      }
    }
  });

  test("Requirement 4.1: research completes well inside the 30s budget", async () => {
    const agent = new AudienceAgent();
    const result = await agent.proposePersonas({
      goal,
      count: 5,
      skipGrounding: true,
    });
    expect(result.durationMs).toBeLessThan(30_000);
    expect(result.personas.length).toBe(5);
  });
});
