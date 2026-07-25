/**
 * Traceability unit tests (Task 9.3).
 * Feature: content-creator-ai
 * Requirements 13.2 (partial chain with in-progress marker, ≤ 3s), 13.4 (human
 * edit event fields), 13.5 (available portion returned for incomplete chains).
 */
import { describe, test, expect, beforeEach } from "vitest";
import {
  TraceabilityBuilder,
  TRACE_STAGES,
  validateChain,
  newHypothesisId,
  newPostVariantId,
} from "@/lib/content-creator-ai/api/traceability.js";

describe("Traceability chain queries", () => {
  let builder: TraceabilityBuilder;

  beforeEach(() => {
    builder = new TraceabilityBuilder();
  });

  // ---- Requirements 13.2, 13.5: in-progress variants ----

  test("an in-progress variant returns its available links within 3 seconds", () => {
    const variantId = newPostVariantId();
    const hypothesisId = newHypothesisId();
    builder.recordAll(variantId, {
      companyContextVersion: "ctx-v3",
      marketingGoal: "goal-7",
      audiencePersona: "persona-2",
      roadmapEntry: "entry-1",
      hypothesis: hypothesisId,
      postVariant: variantId,
    });

    const startedAt = Date.now();
    const result = builder.build(variantId);
    const elapsed = Date.now() - startedAt;

    // Requirement 13.2 — 3 second SLA.
    expect(elapsed).toBeLessThan(3000);
    expect(result.durationMs).toBeLessThan(3000);

    // Requirement 13.5 — available portion plus a status marker.
    expect(result.status).toBe("in_progress");
    expect(result.chain.status).toBe("in_progress");
    expect(result.chain.links).toHaveLength(6);
    expect(result.chain.links.map((l) => l.entityType)).toEqual([
      "companyContextVersion",
      "marketingGoal",
      "audiencePersona",
      "roadmapEntry",
      "hypothesis",
      "postVariant",
    ]);

    // Named fields for reached links are populated...
    expect(result.chain.companyContextVersionId).toBe("ctx-v3");
    expect(result.chain.marketingGoalId).toBe("goal-7");
    expect(result.chain.hypothesisId).toBe(hypothesisId);
    // ...and unreached ones are absent, not empty strings.
    expect(result.chain.publishedRecordId).toBeUndefined();
    expect(result.chain.analyticsReportId).toBeUndefined();
    expect(result.chain.experimentEvaluationId).toBeUndefined();
  });

  test("every returned link carries a non-null id and a parseable timestamp", () => {
    const variantId = newPostVariantId();
    builder.recordAll(variantId, {
      companyContextVersion: "ctx-1",
      marketingGoal: "goal-1",
      postVariant: variantId,
    });

    const { chain } = builder.build(variantId);
    for (const link of chain.links) {
      expect(link.entityId).toBeTruthy();
      expect(link.timestamp).toBeTruthy();
      expect(Number.isNaN(Date.parse(link.timestamp))).toBe(false);
    }
    expect(validateChain(chain).valid).toBe(true);
  });

  test("an unknown variant yields an empty in-progress chain rather than throwing", () => {
    const result = builder.build("never-seen");
    expect(result.status).toBe("in_progress");
    expect(result.chain.links).toEqual([]);
    expect(result.missingStages).toEqual([...TRACE_STAGES]);
    // The queried id is still echoed back on the chain.
    expect(result.chain.postVariantId).toBe("never-seen");
  });

  test("the chain advances through its lifecycle as links are recorded", () => {
    const variantId = newPostVariantId();
    builder.record(variantId, "postVariant", variantId);
    expect(builder.build(variantId).status).toBe("in_progress");

    builder.record(variantId, "publishedRecord", "pub-1");
    expect(builder.build(variantId).status).toBe("partial");

    builder.record(variantId, "analyticsReport", "rep-1");
    expect(builder.build(variantId).status).toBe("partial");

    builder.record(variantId, "experimentEvaluation", "eval-1");
    expect(builder.build(variantId).status).toBe("complete");
  });

  test("recording the same stage twice overwrites rather than duplicating", () => {
    const variantId = newPostVariantId();
    builder.record(variantId, "hypothesis", "first");
    builder.record(variantId, "hypothesis", "second");

    const { chain } = builder.build(variantId);
    const hypothesisLinks = chain.links.filter(
      (l) => l.entityType === "hypothesis",
    );
    expect(hypothesisLinks).toHaveLength(1);
    expect(hypothesisLinks[0].entityId).toBe("second");
  });

  test("an explicit timestamp is preserved for backfilled links", () => {
    const variantId = newPostVariantId();
    const when = "2026-03-01T12:00:00.000Z";
    builder.record(variantId, "marketingGoal", "goal-1", when);

    const { chain } = builder.build(variantId);
    expect(chain.links[0].timestamp).toBe(when);
  });

  // ---- Requirement 13.4: human edit events ----

  test("a human edit records actor, timestamp and both versions", () => {
    const variantId = newPostVariantId();
    builder.record(variantId, "postVariant", variantId);

    const original = { caption: "AI wrote this", cta: "Learn more" };
    const edited = { caption: "A human rewrote this", cta: "Get started" };

    const event = builder.recordHumanEdit({
      postVariantId: variantId,
      actor: "francois@gocohort.com",
      originalVersion: original,
      editedVersion: edited,
      changedFields: ["caption", "cta"],
    });

    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);

    const result = builder.build(variantId);
    expect(result.humanEdits).toHaveLength(1);

    const recorded = result.humanEdits[0];
    expect(recorded.actor).toBe("francois@gocohort.com");
    // Both the AI-generated and the human-edited version are retained.
    expect(recorded.originalVersion).toEqual(original);
    expect(recorded.editedVersion).toEqual(edited);
    expect(recorded.changedFields).toEqual(["caption", "cta"]);
    expect(recorded.postVariantId).toBe(variantId);
  });

  test("successive edits are all retained in order", () => {
    const variantId = newPostVariantId();
    builder.record(variantId, "postVariant", variantId);

    builder.recordHumanEdit({
      postVariantId: variantId,
      actor: "alice",
      originalVersion: { caption: "v0" },
      editedVersion: { caption: "v1" },
    });
    builder.recordHumanEdit({
      postVariantId: variantId,
      actor: "bob",
      originalVersion: { caption: "v1" },
      editedVersion: { caption: "v2" },
    });

    const edits = builder.build(variantId).humanEdits;
    expect(edits).toHaveLength(2);
    expect(edits.map((e) => e.actor)).toEqual(["alice", "bob"]);
    expect(edits[0].editedVersion).toEqual({ caption: "v1" });
    expect(edits[1].originalVersion).toEqual({ caption: "v1" });
    // Distinct ids per event.
    expect(edits[0].id).not.toBe(edits[1].id);
  });

  test("edits are scoped to their own variant", () => {
    const a = newPostVariantId();
    const b = newPostVariantId();
    builder.record(a, "postVariant", a);
    builder.record(b, "postVariant", b);

    builder.recordHumanEdit({
      postVariantId: a,
      actor: "alice",
      originalVersion: {},
      editedVersion: {},
    });

    expect(builder.build(a).humanEdits).toHaveLength(1);
    expect(builder.build(b).humanEdits).toHaveLength(0);
  });

  test("an explicit edit timestamp is preserved", () => {
    const variantId = newPostVariantId();
    const when = "2026-04-01T09:30:00.000Z";
    const event = builder.recordHumanEdit({
      postVariantId: variantId,
      actor: "alice",
      timestamp: when,
      originalVersion: {},
      editedVersion: {},
    });
    expect(event.timestamp).toBe(when);
  });

  // ---- Requirement 13.2: fully-evaluated chain ----

  test("a fully evaluated chain returns all nine links inside the SLA", () => {
    const variantId = newPostVariantId();
    for (const stage of TRACE_STAGES) {
      builder.record(variantId, stage, `${stage}-id`);
    }

    const startedAt = Date.now();
    const result = builder.build(variantId);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(3000);
    expect(result.status).toBe("complete");
    expect(result.chain.links).toHaveLength(9);
    expect(result.missingStages).toEqual([]);
    expect(validateChain(result.chain).valid).toBe(true);
  });

  test("clear removes a single variant without touching others", () => {
    const a = newPostVariantId();
    const b = newPostVariantId();
    builder.record(a, "postVariant", a);
    builder.record(b, "postVariant", b);

    builder.clear(a);
    expect(builder.has(a)).toBe(false);
    expect(builder.has(b)).toBe(true);

    builder.clear();
    expect(builder.has(b)).toBe(false);
    expect(builder.variantIds()).toEqual([]);
  });

  test("validateChain rejects a chain claiming completion without an evaluation", () => {
    const result = validateChain({
      companyContextVersionId: "c",
      marketingGoalId: "g",
      audiencePersonaId: "p",
      roadmapEntryId: "r",
      hypothesisId: "h",
      postVariantId: "v",
      status: "complete",
      links: [{ entityType: "hypothesis", entityId: "h", timestamp: "2026-01-01T00:00:00.000Z" }],
    });
    expect(result.valid).toBe(false);
    expect(result.problems.join(" ")).toContain("without an evaluation link");
  });

  test("validateChain rejects out-of-order links", () => {
    const result = validateChain({
      companyContextVersionId: "c",
      marketingGoalId: "g",
      audiencePersonaId: "",
      roadmapEntryId: "",
      hypothesisId: "",
      postVariantId: "v",
      status: "in_progress",
      links: [
        { entityType: "marketingGoal", entityId: "g", timestamp: "2026-01-01T00:00:00.000Z" },
        { entityType: "companyContextVersion", entityId: "c", timestamp: "2026-01-01T00:00:00.000Z" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.problems.join(" ")).toContain("out of canonical order");
  });
});
