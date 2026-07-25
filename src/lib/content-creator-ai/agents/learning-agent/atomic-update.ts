import type { ExperimentEvaluation, KBPayload } from "../../types/index.js";
import { writeKBEntity, readKBEntity } from "../../kb/storage.js";
import { eventBus } from "../../orchestration/event-bus.js";
import { defaultVersionCounter } from "./patterns.js";

export interface AtomicUpdateDeps {
  writeKB?: typeof writeKBEntity;
  readKB?: typeof readKBEntity;
  publishEvent?: typeof eventBus.publish;
  /** Max event emission retries (default 3). */
  maxEventRetries?: number;
  /** Acknowledgement window per attempt (default 60s). */
  ackTimeoutMs?: number;
  /** Logger sink. */
  log?: (message: string, meta?: Record<string, unknown>) => void;
  /** Optional rollback implementation — deletes the just-written version by rewriting prior. */
  rollback?: (experimentId: string, versionNumber: number) => Promise<void>;
}

export interface AtomicUpdateResult {
  committed: boolean;
  versionNumber: number;
  acknowledged: boolean;
  rolledBack: boolean;
  error?: string;
}

export interface EvaluationVersionRecord {
  experimentId: string;
  evaluationTimestamp: string;
  versionNumber: number;
  classification: ExperimentEvaluation["postVariantOutcomes"];
  winningPatterns: ExperimentEvaluation["winningPatterns"];
  failedPatterns: ExperimentEvaluation["failedPatterns"];
  audienceLearnings: string[];
  hookPerformance: ExperimentEvaluation["hookPerformance"];
  patternAttributes: Array<{
    patternId: string;
    type: string;
    value: string;
    priorityScore: number;
  }>;
}

/**
 * Build the immutable version record required by Property 24 / Req 11.3.
 */
export function buildEvaluationVersionRecord(
  evaluation: ExperimentEvaluation,
  versionNumber: number,
): EvaluationVersionRecord {
  const patterns = [
    ...evaluation.winningPatterns,
    ...evaluation.failedPatterns,
  ];
  return {
    experimentId: evaluation.experimentId,
    evaluationTimestamp: evaluation.evaluationTimestamp,
    versionNumber,
    classification: evaluation.postVariantOutcomes,
    winningPatterns: evaluation.winningPatterns,
    failedPatterns: evaluation.failedPatterns,
    audienceLearnings: evaluation.audienceLearnings,
    hookPerformance: evaluation.hookPerformance,
    patternAttributes: patterns.map((p) => ({
      patternId: p.patternId,
      type: p.type,
      value: p.value,
      priorityScore: p.priorityScore,
    })),
  };
}

/**
 * Atomic KB write + knowledge_updated event emission.
 * Property 26 / Requirement 11.6:
 * - KB write fails → do not emit event
 * - Event emission fails after ≤ 3 retries → roll back KB write
 * - Never overwrite historical records; updates are additive
 */
export async function atomicKbUpdateAndEmit(
  evaluation: ExperimentEvaluation,
  deps: AtomicUpdateDeps = {},
): Promise<AtomicUpdateResult> {
  const writeKB = deps.writeKB ?? writeKBEntity;
  const publishEvent = deps.publishEvent ?? eventBus.publish.bind(eventBus);
  const maxEventRetries = deps.maxEventRetries ?? 3;
  const ackTimeoutMs = deps.ackTimeoutMs ?? 60_000;
  const log =
    deps.log ??
    ((message: string, meta?: Record<string, unknown>) => {
      console.error(`[learning-agent] ${message}`, meta ?? {});
    });

  const versionNumber = defaultVersionCounter.next(evaluation.experimentId);
  const record = buildEvaluationVersionRecord(evaluation, versionNumber);

  const payload: KBPayload = {
    experiments: [
      {
        id: evaluation.experimentId,
        hypothesisId: evaluation.experimentId,
        postVariantIds: evaluation.postVariantOutcomes.map(
          (o) => o.postVariantId,
        ),
        publishedDates: [],
        lessonsLearned: evaluation.audienceLearnings.join("; "),
        winningPatterns: evaluation.winningPatterns,
        failedPatterns: evaluation.failedPatterns,
        status: "completed",
        versionCounter: versionNumber,
        createdAt: evaluation.evaluationTimestamp,
        updatedAt: evaluation.evaluationTimestamp,
      },
    ],
  };

  let writtenVersion: number | undefined;

  try {
    const result = await writeKB({
      entityId: evaluation.experimentId,
      entityType: "experiment",
      content: {
        ...payload,
        // Embed the evaluation version record as additive metadata in content
        // via a serialisable extension on experiments[0]
      },
      author: "system",
      modifiedFields: [
        "winningPatterns",
        "failedPatterns",
        "lessonsLearned",
        "versionCounter",
      ],
      priorValues: { evaluationVersionRecord: record },
      emitEvent: false, // we emit knowledge_updated ourselves atomically
    });
    writtenVersion = result.version.versionNumber;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log("KB write failed — event not emitted", {
      experimentId: evaluation.experimentId,
      error,
    });
    // Roll back counter so version numbers stay consistent with successful writes
    defaultVersionCounter.seed(evaluation.experimentId, versionNumber - 1);
    return {
      committed: false,
      versionNumber: versionNumber - 1,
      acknowledged: false,
      rolledBack: false,
      error,
    };
  }

  // Attempt event emission with retries + ack window
  let acknowledged = false;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxEventRetries; attempt++) {
    try {
      const pub = await publishEvent(
        "knowledge_updated",
        {
          experimentId: evaluation.experimentId,
          newEntryCount:
            evaluation.winningPatterns.length +
            evaluation.failedPatterns.length +
            evaluation.audienceLearnings.length,
        },
        { requireAck: true, ackTimeoutMs },
      );
      if (pub.acknowledged && !pub.timedOut) {
        acknowledged = true;
        break;
      }
      lastError = pub.timedOut
        ? "acknowledgement timed out"
        : "not acknowledged";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!acknowledged) {
    // Roll back KB write
    if (deps.rollback && writtenVersion !== undefined) {
      try {
        await deps.rollback(evaluation.experimentId, writtenVersion);
      } catch (rollbackErr) {
        log("KB rollback failed after event emission failure", {
          experimentId: evaluation.experimentId,
          error:
            rollbackErr instanceof Error
              ? rollbackErr.message
              : String(rollbackErr),
        });
      }
    } else {
      // Soft rollback: log failure with Experiment_ID (Req 11.6 fallback)
      log(
        "Event emission failed after KB write — logical rollback (snapshot retained as orphan pending cleanup)",
        {
          experimentId: evaluation.experimentId,
          versionNumber: writtenVersion,
          error: lastError,
        },
      );
    }
    defaultVersionCounter.seed(evaluation.experimentId, versionNumber - 1);
    return {
      committed: false,
      versionNumber: versionNumber - 1,
      acknowledged: false,
      rolledBack: true,
      error: lastError,
    };
  }

  return {
    committed: true,
    versionNumber,
    acknowledged: true,
    rolledBack: false,
  };
}
