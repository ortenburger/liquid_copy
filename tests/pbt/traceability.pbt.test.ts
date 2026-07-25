// Feature: content-creator-ai, Property 28: Traceability chain contains all required links for any Post_Variant
import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  TraceabilityBuilder,
  TRACE_STAGES,
  validateChain,
  isGloballyUniqueId,
  newHypothesisId,
  newPostVariantId,
  newExperimentId,
  newExperimentEvaluationId,
  type TraceStage,
} from "@/lib/content-creator-ai/api/traceability.js";

/**
 * Lifecycle prefix length: a variant that has reached stage k has links for
 * stages 0..k-1 and nothing beyond. Property 28 is about exactly these prefixes.
 */
const prefixLengthArb = fc.integer({ min: 0, max: TRACE_STAGES.length });

const timestampArb = fc
  .integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

describe("Traceability property tests", () => {
  // Feature: content-creator-ai, Property 28: Traceability chain contains all required links for any Post_Variant
  test("Property 28: reached links are complete, unreached links absent", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        prefixLengthArb,
        fc.array(timestampArb, { minLength: TRACE_STAGES.length, maxLength: TRACE_STAGES.length }),
        (variantId, reached, timestamps) => {
          const builder = new TraceabilityBuilder();

          const recordedStages: TraceStage[] = [];
          for (let i = 0; i < reached; i++) {
            const stage = TRACE_STAGES[i];
            builder.record(variantId, stage, `${stage}-id`, timestamps[i]);
            recordedStages.push(stage);
          }

          const result = builder.build(variantId);

          // Every reached link is present with a non-null id and timestamp.
          if (result.chain.links.length !== reached) return false;
          for (let i = 0; i < reached; i++) {
            const link = result.chain.links[i];
            if (link.entityType !== TRACE_STAGES[i]) return false; // canonical order
            if (!link.entityId) return false;
            if (!link.timestamp || Number.isNaN(Date.parse(link.timestamp))) {
              return false;
            }
          }

          // Unreached links are absent, and reported as missing.
          const expectedMissing = TRACE_STAGES.slice(reached);
          if (result.missingStages.length !== expectedMissing.length) return false;
          for (const stage of expectedMissing) {
            if (!result.missingStages.includes(stage)) return false;
            if (result.chain.links.some((l) => l.entityType === stage)) return false;
          }

          // Status agrees with how far the chain reaches.
          const hasEvaluation = reached === TRACE_STAGES.length;
          if (hasEvaluation && result.status !== "complete") return false;
          if (!hasEvaluation && result.status === "complete") return false;
          if (!hasEvaluation && result.status !== "partial" && result.status !== "in_progress") {
            return false;
          }

          return validateChain(result.chain).valid;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 28: links are stored in canonical order regardless of insert order", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.shuffledSubarray([...TRACE_STAGES], {
          minLength: 1,
          maxLength: TRACE_STAGES.length,
        }),
        (variantId, shuffledStages) => {
          const builder = new TraceabilityBuilder();
          // Record in a scrambled order.
          for (const stage of shuffledStages) {
            builder.record(variantId, stage, `${stage}-id`);
          }

          const { chain } = builder.build(variantId);

          // Resulting links must follow the canonical sequence.
          const indices = chain.links.map((l) =>
            (TRACE_STAGES as readonly string[]).indexOf(l.entityType),
          );
          for (let i = 1; i < indices.length; i++) {
            if (indices[i] <= indices[i - 1]) return false;
          }
          return validateChain(chain).valid;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 28: an unpublished variant reports in_progress", () => {
    const builder = new TraceabilityBuilder();
    const variantId = newPostVariantId();
    builder.recordAll(variantId, {
      companyContextVersion: "ctx-1",
      marketingGoal: "goal-1",
      audiencePersona: "persona-1",
      roadmapEntry: "entry-1",
      hypothesis: newHypothesisId(),
      postVariant: variantId,
    });

    const result = builder.build(variantId);
    // Requirement 13.5 — available portion with an in-progress marker.
    expect(result.status).toBe("in_progress");
    expect(result.chain.links).toHaveLength(6);
    expect(result.chain.publishedRecordId).toBeUndefined();
    expect(result.missingStages).toEqual([
      "publishedRecord",
      "analyticsReport",
      "experimentEvaluation",
    ]);
  });

  test("Property 28: a published-but-unevaluated variant reports partial", () => {
    const builder = new TraceabilityBuilder();
    const variantId = newPostVariantId();
    builder.recordAll(variantId, {
      companyContextVersion: "ctx-1",
      marketingGoal: "goal-1",
      audiencePersona: "persona-1",
      roadmapEntry: "entry-1",
      hypothesis: newHypothesisId(),
      postVariant: variantId,
      publishedRecord: "pub-1",
      analyticsReport: "rep-1",
    });

    const result = builder.build(variantId);
    expect(result.status).toBe("partial");
    expect(result.missingStages).toEqual(["experimentEvaluation"]);
  });

  test("Property 28: a fully evaluated variant reports complete", () => {
    const builder = new TraceabilityBuilder();
    const variantId = newPostVariantId();
    for (const stage of TRACE_STAGES) {
      builder.record(variantId, stage, `${stage}-id`);
    }
    const result = builder.build(variantId);
    expect(result.status).toBe("complete");
    expect(result.missingStages).toEqual([]);
    expect(result.chain.links).toHaveLength(TRACE_STAGES.length);
    expect(validateChain(result.chain).valid).toBe(true);
  });

  // Requirement 13.4
  test("Property 28: human edits capture actor, timestamp and both versions", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 40 }),
        (variantId, actor, before, after) => {
          const builder = new TraceabilityBuilder();
          builder.record(variantId, "postVariant", variantId);

          const event = builder.recordHumanEdit({
            postVariantId: variantId,
            actor,
            originalVersion: { caption: before },
            editedVersion: { caption: after },
            changedFields: ["caption"],
          });

          const result = builder.build(variantId);
          if (result.humanEdits.length !== 1) return false;
          const recorded = result.humanEdits[0];

          return (
            recorded.id === event.id &&
            recorded.actor === actor &&
            !Number.isNaN(Date.parse(recorded.timestamp)) &&
            JSON.stringify(recorded.originalVersion) === JSON.stringify({ caption: before }) &&
            JSON.stringify(recorded.editedVersion) === JSON.stringify({ caption: after }) &&
            recorded.changedFields?.[0] === "caption"
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Requirement 13.3
  test("Requirement 13.3: ids are globally unique v4 UUIDs", () => {
    const generators = [
      newHypothesisId,
      newPostVariantId,
      newExperimentId,
      newExperimentEvaluationId,
    ];
    const seen = new Set<string>();
    for (const generate of generators) {
      for (let i = 0; i < 250; i++) {
        const id = generate();
        expect(isGloballyUniqueId(id)).toBe(true);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(generators.length * 250);
  });

  test("recording a link with an empty entityId is rejected", () => {
    const builder = new TraceabilityBuilder();
    expect(() => builder.record("v1", "hypothesis", "")).toThrow(
      /non-empty entityId/,
    );
  });

  // Requirement 13.2
  test("chain queries are far inside the 3 second SLA", () => {
    const builder = new TraceabilityBuilder();
    // Populate many variants so the lookup is not trivially small.
    for (let i = 0; i < 1000; i++) {
      const id = `variant-${i}`;
      for (const stage of TRACE_STAGES) builder.record(id, stage, `${stage}-${i}`);
    }

    const startedAt = Date.now();
    const result = builder.build("variant-999");
    const elapsed = Date.now() - startedAt;

    expect(result.status).toBe("complete");
    expect(elapsed).toBeLessThan(3000);
    expect(result.durationMs).toBeLessThan(3000);
  });
});
