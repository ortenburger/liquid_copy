// Feature: content-creator-ai, Property 15: Generated roadmap satisfies structural invariants
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AudiencePersona,
  MarketingGoal,
  RoadmapEntry,
} from "@/lib/content-creator-ai/types/index.js";
import {
  generateRoadmap,
  approveRoadmap,
  normaliseRoadmapEntries,
  validateRoadmap,
  MIN_DURATION_WEEKS,
  MAX_DURATION_WEEKS,
} from "@/lib/content-creator-ai/agents/strategy-agent/roadmap.js";
import { OpenCurriculumAdapter } from "@/lib/content-creator-ai/integrations/opencurriculum.js";
import { eventBus } from "@/lib/content-creator-ai/orchestration/event-bus.js";

const nonEmptyString = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

const goalArb: fc.Arbitrary<MarketingGoal> = fc.record({
  id: fc.uuid(),
  primaryObjective: nonEmptyString,
  targetPlatform: fc.constantFrom(
    "instagram" as const,
    "linkedin" as const,
    "tiktok" as const,
  ),
  successMetrics: fc.array(
    fc.record({
      name: nonEmptyString,
      numericTarget: fc.double({ min: 1, max: 1000, noNaN: true }),
      timePeriod: fc.constantFrom("7d", "30d", "90d"),
      direction: fc.constant("increase" as const),
    }),
    { minLength: 1, maxLength: 3 },
  ),
  status: fc.constant("accepted" as const),
  kbVersion: fc.constant("v1"),
  createdAt: fc.constant("2026-01-01T00:00:00.000Z"),
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

describe("Roadmap property tests", () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = mkdtempSync(join(tmpdir(), "roadmap-pbt-"));
    process.env.KB_STORAGE_PATH = storagePath;
    eventBus.clear();
  });

  afterEach(() => {
    eventBus.clear();
    delete process.env.KB_STORAGE_PATH;
    try {
      chmodSync(storagePath, 0o755);
    } catch {
      // may already be writable
    }
    rmSync(storagePath, { recursive: true, force: true });
  });

  // Feature: content-creator-ai, Property 15: Generated roadmap satisfies structural invariants
  test("Property 15: span 2-12 weeks, >= 1 slot per week, objective + metric per entry", async () => {
    await fc.assert(
      fc.asyncProperty(
        goalArb,
        fc.array(personaArb, { minLength: 1, maxLength: 3 }),
        // Deliberately includes out-of-range durations to exercise clamping.
        fc.integer({ min: -5, max: 30 }),
        async (goal, personas, durationWeeks) => {
          const result = await generateRoadmap({
            goal,
            personas,
            durationWeeks,
            storagePath,
            skipGrounding: true,
          });

          const roadmap = result.roadmap;
          if (!roadmap) return false;

          // (a) span within 2-12
          if (roadmap.durationWeeks < MIN_DURATION_WEEKS) return false;
          if (roadmap.durationWeeks > MAX_DURATION_WEEKS) return false;

          // (b) at least one hypothesis slot per scheduled week
          for (let week = 1; week <= roadmap.durationWeeks; week++) {
            if (!roadmap.entries.some((e) => e.weekNumber === week)) return false;
          }

          // (c) each entry links an objective and carries >= 1 success metric
          for (const entry of roadmap.entries) {
            if (!entry.businessObjectiveRef.trim()) return false;
            if (entry.successMetrics.length === 0) return false;
            if (entry.weekNumber < 1 || entry.weekNumber > roadmap.durationWeeks) {
              return false;
            }
          }

          // The module's own structural gate must agree.
          return validateRoadmap(roadmap).valid;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 15 holds when the planner returns junk entries", async () => {
    // A remote planner that skips weeks, emits out-of-range weeks and omits
    // objectives/metrics must still normalise to a valid roadmap.
    await fc.assert(
      fc.asyncProperty(
        goalArb,
        fc.integer({ min: MIN_DURATION_WEEKS, max: MAX_DURATION_WEEKS }),
        async (goal, durationWeeks) => {
          const junk = [
            { id: "", weekNumber: 1, theme: "", hypothesisSlot: null, businessObjectiveRef: "", successMetrics: [], status: "pending" },
            { id: "", weekNumber: 999, theme: "way out of range", hypothesisSlot: null, businessObjectiveRef: "", successMetrics: [], status: "pending" },
            { id: "", weekNumber: -3, theme: "negative", hypothesisSlot: null, businessObjectiveRef: "", successMetrics: [], status: "pending" },
          ] as RoadmapEntry[];

          const entries = normaliseRoadmapEntries(junk, goal, durationWeeks);

          for (let week = 1; week <= durationWeeks; week++) {
            if (!entries.some((e) => e.weekNumber === week)) return false;
          }
          return entries.every(
            (e) =>
              e.id.length > 0 &&
              e.theme.trim().length > 0 &&
              e.businessObjectiveRef.trim().length > 0 &&
              e.successMetrics.length > 0 &&
              e.weekNumber >= 1 &&
              e.weekNumber <= durationWeeks,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Requirement 6.6: first cycle applies no lessons", async () => {
    const goal = fc.sample(goalArb, 1)[0];
    const personas = fc.sample(personaArb, 1);
    const result = await generateRoadmap({
      goal,
      personas,
      durationWeeks: 4,
      storagePath,
      skipGrounding: true,
    });
    expect(result.firstCycle).toBe(true);
    expect(result.lessonsApplied).toEqual([]);
  });

  test("Requirement 6.5: prior lessons are folded into the themes", async () => {
    const goal = fc.sample(goalArb, 1)[0];
    const personas = fc.sample(personaArb, 1);
    const result = await generateRoadmap({
      goal,
      personas,
      durationWeeks: 3,
      lessonsLearned: ["short hooks outperformed long ones"],
      storagePath,
      skipGrounding: true,
    });

    expect(result.firstCycle).toBe(false);
    expect(result.lessonsApplied).toEqual(["short hooks outperformed long ones"]);
    // The built-in planner threads the lesson through the themes.
    expect(
      result.roadmap!.entries.some((e) =>
        e.theme.includes("short hooks outperformed long ones"),
      ),
    ).toBe(true);
  });

  test("Requirement 6.4: storage confirmed schedules exactly the first entry", async () => {
    const goal = fc.sample(goalArb, 1)[0];
    const personas = fc.sample(personaArb, 1);
    const { roadmap } = await generateRoadmap({
      goal,
      personas,
      durationWeeks: 4,
      storagePath,
      skipGrounding: true,
    });

    const approval = await approveRoadmap(roadmap!, { storagePath });
    expect(approval.scheduled).toBe(true);
    expect(approval.roadmap.kbStorageStatus).toBe("confirmed");
    expect(approval.activeEntry).toBeDefined();
    expect(approval.roadmap.entries.filter((e) => e.status === "active")).toHaveLength(1);
    expect(approval.roadmap.entries[0].status).toBe("active");
  });

  test("Requirement 6.4: storage failure schedules nothing and notifies", async () => {
    const goal = fc.sample(goalArb, 1)[0];
    const personas = fc.sample(personaArb, 1);
    const { roadmap } = await generateRoadmap({
      goal,
      personas,
      durationWeeks: 4,
      storagePath,
      skipGrounding: true,
    });

    // Point storage at an unwritable location to force the failure path.
    const approval = await approveRoadmap(roadmap!, {
      storagePath: "/proc/definitely-not-writable-content-creator-ai",
    });

    expect(approval.scheduled).toBe(false);
    expect(approval.roadmap.kbStorageStatus).toBe("failed");
    expect(approval.activeEntry).toBeUndefined();
    // No entry may be marked active while storage is unconfirmed.
    expect(approval.roadmap.entries.every((e) => e.status === "pending")).toBe(true);
    expect(approval.notification).toContain("could not be saved");
  });

  test("Requirement 6.3: a roadmap with a gap cannot be approved", async () => {
    const goal = fc.sample(goalArb, 1)[0];
    const gapped = {
      id: "r1",
      goalId: goal.id,
      durationWeeks: 3,
      // Week 2 is missing.
      entries: [
        { id: "e1", weekNumber: 1, theme: "t1", hypothesisSlot: null, businessObjectiveRef: "o", successMetrics: goal.successMetrics, status: "pending" as const },
        { id: "e3", weekNumber: 3, theme: "t3", hypothesisSlot: null, businessObjectiveRef: "o", successMetrics: goal.successMetrics, status: "pending" as const },
      ],
      kbStorageStatus: "pending" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(validateRoadmap(gapped).valid).toBe(false);
    const approval = await approveRoadmap(gapped, { storagePath });
    expect(approval.scheduled).toBe(false);
    expect(approval.error).toContain("week 2");
  });

  test("OpenCurriculum errors surface a retry closure", async () => {
    const failing = new OpenCurriculumAdapter({
      baseUrl: "https://opencurriculum.invalid",
      fetchImpl: async () => new Response("boom", { status: 500 }),
    });
    const goal = fc.sample(goalArb, 1)[0];

    const result = await generateRoadmap({
      goal,
      personas: fc.sample(personaArb, 1),
      durationWeeks: 4,
      adapter: failing,
      storagePath,
      skipGrounding: true,
    });

    expect(result.roadmap).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error!.notification).toContain("Roadmap generation failed");
    expect(typeof result.error!.retry).toBe("function");
  });
});
