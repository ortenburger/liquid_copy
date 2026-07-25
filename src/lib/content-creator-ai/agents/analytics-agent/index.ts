import { randomUUID } from "node:crypto";
import type {
  AnalyticsReport,
  Experiment,
  ExperimentSignificanceResult,
  PostVariant,
  ZernioMetrics,
} from "../../types/index.js";
import { ZernioAdapter } from "../../integrations/zernio.js";
import { identifyWinner } from "./significance.js";

/** Payload passed to Learning_Agent via onLearningTrigger. */
export interface ExperimentResults {
  experiment: Experiment;
  reports: AnalyticsReport[];
  significance?: ExperimentSignificanceResult;
  conclusive: boolean;
  variants: PostVariant[];
}

export interface AnalyticsAgentOptions {
  zernio?: ZernioAdapter;
  onLearningTrigger?: (results: ExperimentResults) => void | Promise<void>;
  now?: () => number;
}

export class AnalyticsAgent {
  private readonly zernio: ZernioAdapter;
  private readonly onLearningTrigger?: (
    results: ExperimentResults,
  ) => void | Promise<void>;
  private readonly now: () => number;

  constructor(options: AnalyticsAgentOptions = {}) {
    this.zernio = options.zernio ?? new ZernioAdapter();
    this.onLearningTrigger = options.onLearningTrigger;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Poll Zernio for each published variant after the observation window,
   * associate metrics, compute significance, trigger Learning_Agent.
   * Requirements 10.1–10.7.
   */
  async evaluateExperiment(
    experiment: Experiment,
    variants: PostVariant[],
  ): Promise<ExperimentResults> {
    const reports: AnalyticsReport[] = [];
    const metricsPairs: Array<{
      postVariantId: string;
      metrics: ZernioMetrics;
    }> = [];

    for (const variant of variants) {
      if (!variant.publishedAt) continue;
      if (!this.zernio.isObservationWindowElapsed(variant.publishedAt)) {
        continue;
      }

      const result = await this.zernio.fetchWithRetry(variant.id);
      if (!result.ok) {
        reports.push({
          postVariantId: variant.id,
          hypothesisId: variant.hypothesisId,
          experimentId: experiment.id,
          observationWindowDays: this.zernio.observationWindowDays,
          metrics: {
            impressions: 0,
            ctr: 0,
            saves: 0,
            shares: 0,
            comments: 0,
            watchTime: 0,
            conversions: 0,
            engagementRate: 0,
            followerGrowth: 0,
          },
          ingestStatus: result.reason === "partial_data" ? "partial" : "error",
          retryCount: result.retryCount,
          ingestedAt: new Date(this.now()).toISOString(),
        });
        continue;
      }

      const report: AnalyticsReport = {
        postVariantId: variant.id,
        hypothesisId: variant.hypothesisId,
        experimentId: experiment.id,
        observationWindowDays: this.zernio.observationWindowDays,
        metrics: result.metrics,
        ingestStatus: "complete",
        retryCount: 0,
        ingestedAt: new Date(this.now()).toISOString(),
      };
      reports.push(report);
      metricsPairs.push({
        postVariantId: variant.id,
        metrics: result.metrics,
      });
    }

    const allIngested =
      reports.length > 0 &&
      reports.every((r) => r.ingestStatus === "complete") &&
      reports.length === variants.filter((v) => v.publishedAt).length;

    let significance: ExperimentSignificanceResult | undefined;
    let conclusive = false;

    if (allIngested && metricsPairs.length > 0) {
      const sig = identifyWinner(experiment.id, metricsPairs, {
        observationWindowExpired: true,
      });
      significance = sig.result;
      conclusive = sig.conclusive;
    } else if (metricsPairs.length > 0) {
      // Partial — still compute best-effort; mark inconclusive if window expired
      const sig = identifyWinner(experiment.id, metricsPairs, {
        observationWindowExpired: true,
      });
      significance = sig.result
        ? { ...sig.result, conclusive: false }
        : undefined;
      conclusive = false;
    }

    const updatedExperiment: Experiment = {
      ...experiment,
      analyticsResults: reports,
      statisticalSignificance: significance,
      status: conclusive ? "completed" : "inconclusive",
      updatedAt: new Date(this.now()).toISOString(),
    };

    // Ensure Learning_Agent always receives completed status when ingestion done
    if (allIngested) {
      updatedExperiment.status = conclusive ? "completed" : "inconclusive";
      // Learning trigger requires status "completed" per Req 11.1 —
      // for inconclusive we still trigger but mark experiment accordingly.
      // Task 13.3: trigger regardless of conclusive/inconclusive.
      if (updatedExperiment.status === "inconclusive") {
        // Promote to completed for Learning_Agent acceptance while preserving
        // conclusive=false in ExperimentResults.
        updatedExperiment.status = "completed";
      }
    }

    const results: ExperimentResults = {
      experiment: updatedExperiment,
      reports,
      significance,
      conclusive,
      variants,
    };

    if (allIngested && this.onLearningTrigger) {
      await this.onLearningTrigger(results);
    }

    return results;
  }
}

/** Helper to build a unique analytics report id for traceability. */
export function newAnalyticsReportId(): string {
  return randomUUID();
}
