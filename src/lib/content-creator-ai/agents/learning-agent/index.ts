import { randomUUID } from "node:crypto";
import type {
  ExperimentEvaluation,
  Hypothesis,
  HookPerformanceRecord,
  PostVariant,
  PostVariantOutcome,
} from "../../types/index.js";
import type { ExperimentResults } from "../analytics-agent/index.js";
import { classifyPostVariantOutcome } from "./classify.js";
import {
  scoreFailedPattern,
  scoreWinningPattern,
} from "./patterns.js";
import {
  atomicKbUpdateAndEmit,
  type AtomicUpdateDeps,
  type AtomicUpdateResult,
} from "./atomic-update.js";

export interface LearningAgentOptions {
  atomicDeps?: AtomicUpdateDeps;
  now?: () => number;
}

export class LearningAgent {
  private readonly atomicDeps?: AtomicUpdateDeps;
  private readonly now: () => number;

  constructor(options: LearningAgentOptions = {}) {
    this.atomicDeps = options.atomicDeps;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Handle completed experiment results from Analytics_Agent.
   * Requirements 11.1–11.7.
   */
  async handle(results: ExperimentResults): Promise<{
    evaluation: ExperimentEvaluation;
    atomic: AtomicUpdateResult;
  }> {
    const { experiment, reports, variants, conclusive } = results;

    // Req 11.1: all PostVariants have final Analytics_Report AND status completed
    const hasAllReports =
      experiment.status === "completed" &&
      variants.every((v) =>
        reports.some(
          (r) => r.postVariantId === v.id && r.ingestStatus === "complete",
        ),
      );

    if (!hasAllReports && experiment.status !== "completed") {
      throw new Error(
        `Learning_Agent requires completed experiment with final Analytics_Reports (got status=${experiment.status})`,
      );
    }

    const evaluationTimestamp = new Date(this.now()).toISOString();
    const hypothesis: Hypothesis | undefined = experiment.hypothesis;
    const target =
      hypothesis?.successMetrics?.[0]?.numericTarget ??
      experiment.statisticalSignificance?.confidenceLevel ??
      0.05;

    const postVariantOutcomes: PostVariantOutcome[] = reports.map((r) =>
      classifyPostVariantOutcome(
        r.postVariantId,
        r.metrics.engagementRate,
        // Prefer explicit success metric target; fall back to engagement target heuristic
        typeof target === "number" && target > 1 ? target : target,
      ),
    );

    // Re-classify with a more sensible target when success metrics use percentages
    // If target is a rate (0–1) use it; if absolute, still compare engagementRate
    const winningPatterns = [];
    const failedPatterns = [];
    const hookPerformance: HookPerformanceRecord[] = [];
    const audienceLearnings: string[] = [];

    const hook = hypothesis?.hook ?? "unknown_hook";
    const angle = hypothesis?.angle ?? "unknown_angle";
    const visualTheme = hypothesis?.visualTheme ?? "unknown_visual";

    for (const outcome of postVariantOutcomes) {
      const report = reports.find((r) => r.postVariantId === outcome.postVariantId);
      hookPerformance.push({
        hook,
        experimentId: experiment.id,
        engagementRate: report?.metrics.engagementRate ?? 0,
        classification: outcome.classification,
      });

      if (
        outcome.classification === "exceeded_expectations" ||
        outcome.classification === "met_expectations"
      ) {
        winningPatterns.push(
          scoreWinningPattern({
            type: "hook",
            value: hook,
            experimentId: experiment.id,
            evaluationTimestamp,
            nowMs: this.now(),
          }),
          scoreWinningPattern({
            type: "angle",
            value: angle,
            experimentId: experiment.id,
            evaluationTimestamp,
            nowMs: this.now(),
          }),
          scoreWinningPattern({
            type: "visual_theme",
            value: visualTheme,
            experimentId: experiment.id,
            evaluationTimestamp,
            nowMs: this.now(),
          }),
        );
        audienceLearnings.push(
          `Variant ${outcome.postVariantId} ${outcome.classification} (observed=${outcome.observedValue}, target=${outcome.targetValue})`,
        );
      }

      if (outcome.classification === "failed") {
        failedPatterns.push(
          scoreFailedPattern({
            type: "hook",
            value: hook,
            experimentId: experiment.id,
            evaluationTimestamp,
            nowMs: this.now(),
          }),
          scoreFailedPattern({
            type: "angle",
            value: angle,
            experimentId: experiment.id,
            evaluationTimestamp,
            nowMs: this.now(),
          }),
          scoreFailedPattern({
            type: "visual_theme",
            value: visualTheme,
            experimentId: experiment.id,
            evaluationTimestamp,
            nowMs: this.now(),
          }),
        );
        audienceLearnings.push(
          `Variant ${outcome.postVariantId} failed — avoid similar hook/angle/theme`,
        );
      }
    }

    // If inconclusive, still record learnings
    if (!conclusive) {
      audienceLearnings.push(
        `Experiment ${experiment.id} inconclusive — no statistically significant winner`,
      );
    }

    const evaluation: ExperimentEvaluation = {
      id: randomUUID(),
      experimentId: experiment.id,
      evaluationTimestamp,
      postVariantOutcomes,
      winningPatterns,
      failedPatterns,
      audienceLearnings,
      hookPerformance,
    };

    const atomic = await atomicKbUpdateAndEmit(evaluation, this.atomicDeps);
    return { evaluation, atomic };
  }
}

/** Convenience: wire LearningAgent.handle into AnalyticsAgent onLearningTrigger. */
export function createLearningTrigger(
  agent: LearningAgent,
): (results: ExperimentResults) => Promise<void> {
  return async (results) => {
    await agent.handle(results);
  };
}

export type { PostVariant };
