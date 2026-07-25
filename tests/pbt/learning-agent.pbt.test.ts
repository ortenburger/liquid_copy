// Feature: content-creator-ai, Property 24: Evaluation version records always contain all required fields
// Feature: content-creator-ai, Property 25: Priority scores respect the winning/failed rule
// Feature: content-creator-ai, Property 26: KB update and event emission are atomic
import { describe, test, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEvaluationVersionRecord,
  atomicKbUpdateAndEmit,
} from "../../src/lib/content-creator-ai/agents/learning-agent/atomic-update.js";
import {
  scoreFailedPattern,
  scoreWinningPattern,
  ExperimentVersionCounter,
  defaultVersionCounter,
} from "../../src/lib/content-creator-ai/agents/learning-agent/patterns.js";
import { eventBus } from "../../src/lib/content-creator-ai/orchestration/event-bus.js";
import type { ExperimentEvaluation } from "../../src/lib/content-creator-ai/types/index.js";
import { writeKBEntity } from "../../src/lib/content-creator-ai/kb/storage.js";

function makeEvaluation(
  overrides: Partial<ExperimentEvaluation> = {},
): ExperimentEvaluation {
  const experimentId = overrides.experimentId ?? "exp-test";
  const ts = overrides.evaluationTimestamp ?? new Date().toISOString();
  return {
    id: overrides.id ?? "eval-1",
    experimentId,
    evaluationTimestamp: ts,
    postVariantOutcomes: overrides.postVariantOutcomes ?? [
      {
        postVariantId: "pv-1",
        classification: "met_expectations",
        observedValue: 0.05,
        targetValue: 0.05,
      },
    ],
    winningPatterns: overrides.winningPatterns ?? [
      scoreWinningPattern({
        type: "hook",
        value: "hook-a",
        experimentId,
        evaluationTimestamp: ts,
      }),
    ],
    failedPatterns: overrides.failedPatterns ?? [
      scoreFailedPattern({
        type: "angle",
        value: "angle-b",
        experimentId,
        evaluationTimestamp: ts,
      }),
    ],
    audienceLearnings: overrides.audienceLearnings ?? ["learning-1"],
    hookPerformance: overrides.hookPerformance ?? [
      {
        hook: "hook-a",
        experimentId,
        engagementRate: 0.05,
        classification: "met_expectations",
      },
    ],
  };
}

describe("Property 24: Evaluation version records always contain all required fields", () => {
  test("version record has Experiment_ID, timestamp, classifications, patterns", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 100 }),
        fc.array(
          fc.record({
            postVariantId: fc.uuid(),
            classification: fc.constantFrom(
              "exceeded_expectations",
              "met_expectations",
              "below_expectations",
              "failed",
            ) as fc.Arbitrary<
              | "exceeded_expectations"
              | "met_expectations"
              | "below_expectations"
              | "failed"
            >,
            observedValue: fc.double({ min: 0, max: 1, noNaN: true }),
            targetValue: fc.double({ min: 0.01, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (experimentId, versionNumber, outcomes) => {
          const evaluation = makeEvaluation({
            experimentId,
            postVariantOutcomes: outcomes,
          });
          const record = buildEvaluationVersionRecord(
            evaluation,
            versionNumber,
          );
          return (
            record.experimentId === experimentId &&
            typeof record.evaluationTimestamp === "string" &&
            record.evaluationTimestamp.length > 0 &&
            record.classification.length === outcomes.length &&
            Array.isArray(record.winningPatterns) &&
            Array.isArray(record.failedPatterns) &&
            Array.isArray(record.patternAttributes) &&
            record.patternAttributes.every(
              (p) =>
                typeof p.patternId === "string" &&
                typeof p.type === "string" &&
                typeof p.value === "string" &&
                typeof p.priorityScore === "number",
            )
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 25: Priority scores respect the winning/failed rule", () => {
  test("winning > 0.0 and failed === 0.0", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom("hook", "angle", "visual_theme") as fc.Arbitrary<
          "hook" | "angle" | "visual_theme"
        >,
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 90 }),
        (experimentId, type, value, ageDays) => {
          const ts = new Date(
            Date.now() - ageDays * 24 * 60 * 60 * 1000,
          ).toISOString();
          const win = scoreWinningPattern({
            type,
            value,
            experimentId,
            evaluationTimestamp: ts,
          });
          const fail = scoreFailedPattern({
            type,
            value,
            experimentId,
            evaluationTimestamp: ts,
          });
          return win.priorityScore > 0.0 && fail.priorityScore === 0.0;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 26: KB update and event emission are atomic", () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = mkdtempSync(join(tmpdir(), "cci-atomic-"));
    eventBus.clear();
    // Reset counter for isolation
    const counter = new ExperimentVersionCounter();
    void counter;
    process.env.KB_STORAGE_PATH = storagePath;
  });

  test("either both commit or neither — never partial", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.boolean(),
        fc.boolean(),
        async (experimentId, failWrite, failEvent) => {
          eventBus.clear();
          defaultVersionCounter.seed(experimentId, 0);

          const state = {
            kbWritten: false,
            eventEmitted: false,
            rolledBack: false,
          };

          // Always subscribe so ack can succeed when event fires
          const unsub = eventBus.subscribe("knowledge_updated", async () => {
            /* ack */
          });

          const evaluation = makeEvaluation({ experimentId });

          const result = await atomicKbUpdateAndEmit(evaluation, {
            ackTimeoutMs: 200,
            maxEventRetries: failEvent ? 2 : 3,
            writeKB: async (opts) => {
              if (failWrite) {
                throw new Error("simulated KB write failure");
              }
              const r = await writeKBEntity(
                { ...opts, emitEvent: false },
                storagePath,
              );
              state.kbWritten = true;
              return r;
            },
            publishEvent: async (name, payload, options) => {
              if (failEvent) {
                throw new Error("simulated event failure");
              }
              state.eventEmitted = true;
              return eventBus.publish(name, payload, options);
            },
            rollback: async () => {
              state.rolledBack = true;
              state.kbWritten = false;
            },
            log: () => undefined,
          });

          unsub();

          // Observable outcomes: (a) both committed, or (b) neither
          if (result.committed) {
            return (
              state.kbWritten &&
              state.eventEmitted &&
              result.acknowledged &&
              !result.rolledBack
            );
          }

          // Not committed: either write never happened, or rollback cleared it
          const neither =
            (!state.kbWritten && !state.eventEmitted) ||
            (state.rolledBack && !result.committed);
          // Event must never be emitted without a successful commit
          const noOrphanEvent = !(
            state.eventEmitted &&
            !result.committed &&
            !failEvent
          );
          // When write fails, event must not emit
          const writeFailImpliesNoEvent = failWrite ? !state.eventEmitted : true;

          return neither && noOrphanEvent && writeFailImpliesNoEvent;
        },
      ),
      { numRuns: 100 },
    );

    try {
      rmSync(storagePath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});
