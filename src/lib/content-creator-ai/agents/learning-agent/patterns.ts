import { randomUUID } from "node:crypto";
import type { ContentPattern } from "../../types/index.js";

export type PatternType = ContentPattern["type"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Half-life in days for recency weighting. */
const RECENCY_HALF_LIFE_DAYS = 30;

/**
 * Recency weight in (0, 1]: newer → closer to 1.
 */
export function computeRecencyWeight(
  evaluationTimestamp: string,
  nowMs = Date.now(),
): number {
  const ts = Date.parse(evaluationTimestamp);
  if (!Number.isFinite(ts)) return 0.5;
  const ageDays = Math.max(0, (nowMs - ts) / MS_PER_DAY);
  return Math.exp((-Math.LN2 * ageDays) / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Winning patterns: recency-weighted priorityScore > 0.0
 * Failed patterns: priorityScore = 0.0 exactly
 * Property 25 / Requirements 11.4, 11.5.
 */
export function scoreWinningPattern(input: {
  type: PatternType;
  value: string;
  experimentId: string;
  evaluationTimestamp: string;
  nowMs?: number;
}): ContentPattern {
  const recencyWeight = computeRecencyWeight(
    input.evaluationTimestamp,
    input.nowMs,
  );
  // Ensure strictly > 0 even for very old timestamps
  const priorityScore = Math.max(1e-6, recencyWeight);

  return {
    patternId: randomUUID(),
    type: input.type,
    value: input.value,
    priorityScore,
    experimentId: input.experimentId,
    recencyWeight,
  };
}

export function scoreFailedPattern(input: {
  type: PatternType;
  value: string;
  experimentId: string;
  evaluationTimestamp: string;
  nowMs?: number;
}): ContentPattern {
  const recencyWeight = computeRecencyWeight(
    input.evaluationTimestamp,
    input.nowMs,
  );
  return {
    patternId: randomUUID(),
    type: input.type,
    value: input.value,
    priorityScore: 0.0,
    experimentId: input.experimentId,
    recencyWeight,
  };
}

/**
 * In-memory monotonically incrementing version counter per experimentId.
 * Requirement 11.7.
 */
export class ExperimentVersionCounter {
  private readonly counters = new Map<string, number>();

  next(experimentId: string): number {
    const current = this.counters.get(experimentId) ?? 0;
    const next = current + 1;
    this.counters.set(experimentId, next);
    return next;
  }

  current(experimentId: string): number {
    return this.counters.get(experimentId) ?? 0;
  }

  seed(experimentId: string, value: number): void {
    this.counters.set(experimentId, value);
  }
}

export const defaultVersionCounter = new ExperimentVersionCounter();
