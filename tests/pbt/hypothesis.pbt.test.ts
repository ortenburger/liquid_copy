// Feature: content-creator-ai, Property 16: Generated hypothesis always contains all seven required fields with valid success metrics
// Feature: content-creator-ai, Property 17: Hypothesis generation does not proceed with fewer than 3 prior outcomes
// Feature: content-creator-ai, Property 18: Hypothesis modification preserves original as a versioned alternative
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AudiencePersona,
  ContentPattern,
  Hypothesis,
  MarketingGoal,
  RAGPassage,
  RoadmapEntry,
} from "@/lib/content-creator-ai/types/index.js";
import {
  generateHypothesis,
  modifyHypothesis,
  approveHypothesis,
  rejectHypothesis,
  detectFailedPatternConflicts,
  validateHypothesis,
  MIN_PRIOR_OUTCOMES,
  REQUIRED_HYPOTHESIS_FIELDS,
} from "@/lib/content-creator-ai/agents/strategy-agent/hypothesis.js";
import {
  setLLMClient,
  resetLLMClient,
  UnavailableLLMClient,
  ScriptedLLMClient,
} from "@/lib/content-creator-ai/integrations/llm.js";
import { eventBus } from "@/lib/content-creator-ai/orchestration/event-bus.js";

const nonEmptyString = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

const goal: MarketingGoal = {
  id: "goal-1",
  primaryObjective: "Grow qualified trial signups",
  targetPlatform: "linkedin",
  successMetrics: [
    { name: "engagement_rate", numericTarget: 5, timePeriod: "30d", direction: "increase" },
  ],
  status: "accepted",
  kbVersion: "v1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const roadmapEntryArb: fc.Arbitrary<RoadmapEntry> = fc.record({
  id: fc.uuid(),
  weekNumber: fc.integer({ min: 1, max: 12 }),
  theme: nonEmptyString,
  hypothesisSlot: fc.constant(null),
  businessObjectiveRef: nonEmptyString,
  successMetrics: fc.array(
    fc.record({
      name: nonEmptyString,
      numericTarget: fc.double({ min: 1, max: 500, noNaN: true }),
      timePeriod: fc.constantFrom("7d", "30d"),
      direction: fc.constant("increase" as const),
    }),
    { minLength: 1, maxLength: 2 },
  ),
  status: fc.constant("active" as const),
});

const personaArb: fc.Arbitrary<AudiencePersona> = fc.record({
  id: fc.uuid(),
  icpDefinition: nonEmptyString,
  painPoints: fc.array(nonEmptyString, { minLength: 1, maxLength: 3 }),
  jobsToBeDone: fc.array(nonEmptyString, { maxLength: 2 }),
  objections: fc.array(nonEmptyString, { maxLength: 2 }),
  dreamOutcomes: fc.array(nonEmptyString, { maxLength: 2 }),
  source: fc.constant("ai_generated" as const),
  kbVersion: fc.constant("v1"),
  createdAt: fc.constant("2026-01-01T00:00:00.000Z"),
});

function passages(n: number): RAGPassage[] {
  return Array.from({ length: n }, (_, i) => ({
    content: `prior experiment outcome ${i + 1}`,
    sourceDoc: `exp-${i + 1}`,
    similarityScore: 0.9 - i * 0.05,
    scope: "experiment_history" as const,
  }));
}

describe("Hypothesis property tests", () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = mkdtempSync(join(tmpdir(), "hypothesis-pbt-"));
    process.env.KB_STORAGE_PATH = storagePath;
    setLLMClient(new UnavailableLLMClient());
    eventBus.clear();
  });

  afterEach(() => {
    resetLLMClient();
    eventBus.clear();
    delete process.env.KB_STORAGE_PATH;
    rmSync(storagePath, { recursive: true, force: true });
  });

  // Feature: content-creator-ai, Property 16: Generated hypothesis always contains all seven required fields with valid success metrics
  test("Property 16: all seven fields non-empty with >= 1 usable success metric", async () => {
    await fc.assert(
      fc.asyncProperty(
        roadmapEntryArb,
        fc.array(personaArb, { minLength: 0, maxLength: 3 }),
        async (roadmapEntry, personas) => {
          const result = await generateHypothesis({
            roadmapEntry,
            marketingGoal: goal,
            audiencePersonas: personas,
            // >= 3 prior outcomes so Property 17 lets generation through.
            ragPassages: passages(MIN_PRIOR_OUTCOMES),
            storagePath,
          });

          if (result.status !== "generated") return false;
          const h = result.hypothesis;

          for (const field of REQUIRED_HYPOTHESIS_FIELDS) {
            if (field === "successMetrics") continue;
            const value = h[field];
            if (typeof value !== "string" || value.trim().length === 0) return false;
          }

          const hasUsableMetric = h.successMetrics.some(
            (m) =>
              m.name.trim().length > 0 &&
              typeof m.numericTarget === "number" &&
              Number.isFinite(m.numericTarget),
          );
          if (!hasUsableMetric) return false;

          // Traceability links must be populated at creation (Req 13.3).
          if (h.roadmapEntryId !== roadmapEntry.id) return false;
          if (h.goalId !== goal.id) return false;
          if (h.id.length === 0) return false;

          return validateHypothesis(h).valid;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 16 holds when the model returns blank fields", async () => {
    setLLMClient(
      new ScriptedLLMClient([
        '{"hook":"","angle":"   ","coreCopy":"","painPoint":"","theme":"","visualTheme":"","successMetrics":[{"name":"","numericTarget":"nope"}]}',
      ]),
    );

    const result = await generateHypothesis({
      roadmapEntry: fc.sample(roadmapEntryArb, 1)[0],
      marketingGoal: goal,
      audiencePersonas: fc.sample(personaArb, 1),
      ragPassages: passages(3),
      storagePath,
    });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") return;
    expect(validateHypothesis(result.hypothesis).valid).toBe(true);
  });

  // Feature: content-creator-ai, Property 17: Hypothesis generation does not proceed with fewer than 3 prior outcomes
  test("Property 17: 1-2 prior outcomes never produce a hypothesis", async () => {
    await fc.assert(
      fc.asyncProperty(
        roadmapEntryArb,
        fc.integer({ min: 1, max: MIN_PRIOR_OUTCOMES - 1 }),
        fc.boolean(),
        async (roadmapEntry, outcomeCount, firstCycle) => {
          const result = await generateHypothesis({
            roadmapEntry,
            marketingGoal: goal,
            audiencePersonas: fc.sample(personaArb, 1),
            ragPassages: passages(outcomeCount),
            // The first-cycle exception applies only at ZERO outcomes, so it
            // must not rescue 1 or 2 either way.
            firstCycle,
            storagePath,
          });

          return (
            result.status === "insufficient_history" &&
            result.priorOutcomeCount === outcomeCount &&
            result.message.length > 0
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 17: >= 3 prior outcomes always proceed", async () => {
    await fc.assert(
      fc.asyncProperty(
        roadmapEntryArb,
        fc.integer({ min: MIN_PRIOR_OUTCOMES, max: 10 }),
        async (roadmapEntry, outcomeCount) => {
          const result = await generateHypothesis({
            roadmapEntry,
            marketingGoal: goal,
            audiencePersonas: fc.sample(personaArb, 1),
            ragPassages: passages(outcomeCount),
            storagePath,
          });
          return result.status === "generated";
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 17: zero outcomes proceed only on the first cycle", async () => {
    const base = {
      roadmapEntry: fc.sample(roadmapEntryArb, 1)[0],
      marketingGoal: goal,
      audiencePersonas: fc.sample(personaArb, 1),
      ragPassages: [] as RAGPassage[],
      storagePath,
    };

    const firstCycle = await generateHypothesis({ ...base, firstCycle: true });
    expect(firstCycle.status).toBe("generated");

    const laterCycle = await generateHypothesis({ ...base, firstCycle: false });
    expect(laterCycle.status).toBe("insufficient_history");
  });

  // Feature: content-creator-ai, Property 18: Hypothesis modification preserves original as a versioned alternative
  test("Property 18: modification archives the original fields and timestamp", async () => {
    await fc.assert(
      fc.asyncProperty(
        roadmapEntryArb,
        fc.record({
          hook: nonEmptyString,
          angle: nonEmptyString,
          coreCopy: nonEmptyString,
        }),
        async (roadmapEntry, edits) => {
          const generated = await generateHypothesis({
            roadmapEntry,
            marketingGoal: goal,
            audiencePersonas: fc.sample(personaArb, 1),
            ragPassages: passages(3),
            storagePath,
          });
          if (generated.status !== "generated") return false;
          const original = generated.hypothesis;

          const modified = modifyHypothesis(original, edits);

          // Current version reflects the edits.
          if (modified.hook !== edits.hook) return false;
          if (modified.angle !== edits.angle) return false;
          if (modified.coreCopy !== edits.coreCopy) return false;
          if (modified.status !== "modified") return false;

          // Exactly one new archived alternative.
          if (modified.versions.length !== original.versions.length + 1) return false;
          const archived = modified.versions[modified.versions.length - 1];

          // Original field values retained.
          if (archived.fields.hook !== original.hook) return false;
          if (archived.fields.angle !== original.angle) return false;
          if (archived.fields.coreCopy !== original.coreCopy) return false;
          if (archived.fields.painPoint !== original.painPoint) return false;
          if (archived.fields.theme !== original.theme) return false;
          if (archived.fields.visualTheme !== original.visualTheme) return false;

          // Original creation timestamp retained.
          if (archived.fields.createdAt !== original.createdAt) return false;
          if (archived.timestamp !== original.createdAt) return false;
          return archived.versionId.length > 0;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 18: repeated modifications keep every earlier alternative", async () => {
    const generated = await generateHypothesis({
      roadmapEntry: fc.sample(roadmapEntryArb, 1)[0],
      marketingGoal: goal,
      audiencePersonas: fc.sample(personaArb, 1),
      ragPassages: passages(3),
      storagePath,
    });
    expect(generated.status).toBe("generated");
    if (generated.status !== "generated") return;

    const original = generated.hypothesis;
    const v1 = modifyHypothesis(original, { hook: "hook one" });
    const v2 = modifyHypothesis(v1, { hook: "hook two" });
    const v3 = modifyHypothesis(v2, { hook: "hook three" });

    expect(v3.hook).toBe("hook three");
    expect(v3.versions).toHaveLength(3);
    // Append-only: the earliest archive still holds the true original.
    expect(v3.versions[0].fields.hook).toBe(original.hook);
    expect(v3.versions[1].fields.hook).toBe("hook one");
    expect(v3.versions[2].fields.hook).toBe("hook two");
    // The original object was not mutated.
    expect(original.versions).toHaveLength(0);
  });

  // Requirement 7.3
  test("failed patterns are flagged with an alternative proposed", async () => {
    const failedPatterns: ContentPattern[] = [
      {
        patternId: "p1",
        type: "hook",
        value: "A better way to handle churn",
        priorityScore: 0,
        experimentId: "exp-9",
        recencyWeight: 0.5,
      },
    ];

    setLLMClient(
      new ScriptedLLMClient([
        JSON.stringify({
          hook: "A better way to handle churn",
          angle: "angle",
          coreCopy: "copy",
          painPoint: "churn",
          theme: "retention",
          visualTheme: "clean",
          successMetrics: [{ name: "engagement_rate", numericTarget: 5, timePeriod: "30d" }],
        }),
      ]),
    );

    const result = await generateHypothesis({
      roadmapEntry: fc.sample(roadmapEntryArb, 1)[0],
      marketingGoal: goal,
      audiencePersonas: fc.sample(personaArb, 1),
      ragPassages: passages(3),
      failedPatterns,
      storagePath,
    });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") return;
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].field).toBe("hook");
    expect(result.proposedAlternative?.hook).toBeDefined();
  });

  test("a winning pattern (score > 0) is never treated as a conflict", () => {
    const winning: ContentPattern = {
      patternId: "p2",
      type: "hook",
      value: "shared hook text",
      priorityScore: 0.8,
      experimentId: "exp-1",
      recencyWeight: 1,
    };
    const conflicts = detectFailedPatternConflicts(
      { hook: "shared hook text", angle: "a", visualTheme: "v" },
      [winning],
    );
    expect(conflicts).toHaveLength(0);
  });

  // Requirement 7.5
  test("approval survives a KB write failure with a warning", async () => {
    const generated = await generateHypothesis({
      roadmapEntry: fc.sample(roadmapEntryArb, 1)[0],
      marketingGoal: goal,
      audiencePersonas: fc.sample(personaArb, 1),
      ragPassages: passages(3),
      storagePath,
    });
    expect(generated.status).toBe("generated");
    if (generated.status !== "generated") return;

    const result = await approveHypothesis(generated.hypothesis, {
      storagePath: "/proc/definitely-not-writable-content-creator-ai",
    });

    // Requirement 7.5 — approval proceeds despite the failed write.
    expect(result.approved).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.hypothesis.status).toBe("approved");
    expect(result.hypothesis.kbStorageStatus).toBe("failed");
    expect(result.warning).toContain("could not be saved");
  });

  test("successful approval records persistence", async () => {
    const generated = await generateHypothesis({
      roadmapEntry: fc.sample(roadmapEntryArb, 1)[0],
      marketingGoal: goal,
      audiencePersonas: fc.sample(personaArb, 1),
      ragPassages: passages(3),
      storagePath,
    });
    if (generated.status !== "generated") throw new Error("expected generation");

    const result = await approveHypothesis(generated.hypothesis, { storagePath });
    expect(result.persisted).toBe(true);
    expect(result.hypothesis.kbStorageStatus).toBe("persisted");
    expect(result.kbVersion).toBeTruthy();
  });

  // Requirement 7.7
  test("rejection discards the draft and regenerates under new constraints", async () => {
    const roadmapEntry = fc.sample(roadmapEntryArb, 1)[0];
    const options = {
      roadmapEntry,
      marketingGoal: goal,
      audiencePersonas: fc.sample(personaArb, 1),
      ragPassages: passages(3),
      storagePath,
    };

    const generated = await generateHypothesis(options);
    if (generated.status !== "generated") throw new Error("expected generation");

    const rejection = await rejectHypothesis(generated.hypothesis, {
      ...options,
      instructions: "Lead with a customer result instead of a question",
    });

    expect(rejection.discardedId).toBe(generated.hypothesis.id);
    expect(rejection.notification).toContain("rejected");
    expect(rejection.replacement.status).toBe("generated");
    if (rejection.replacement.status !== "generated") return;
    // The replacement is a distinct record.
    expect(rejection.replacement.hypothesis.id).not.toBe(generated.hypothesis.id);
  });

  test("validateHypothesis rejects each missing field individually", () => {
    const complete: Hypothesis = {
      id: "h1",
      hook: "h",
      angle: "a",
      coreCopy: "c",
      painPoint: "p",
      theme: "t",
      visualTheme: "v",
      successMetrics: [
        { name: "m", numericTarget: 1, timePeriod: "7d", direction: "increase" },
      ],
      roadmapEntryId: "r",
      goalId: "g",
      status: "draft",
      kbStorageStatus: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      versions: [],
    };
    expect(validateHypothesis(complete).valid).toBe(true);

    for (const field of ["hook", "angle", "coreCopy", "painPoint", "theme", "visualTheme"] as const) {
      const broken = { ...complete, [field]: "  " };
      const result = validateHypothesis(broken);
      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain(field);
    }

    expect(validateHypothesis({ ...complete, successMetrics: [] }).valid).toBe(false);
  });
});
