/**
 * End-to-end traceability (Task 9.1) — Requirements 13.1–13.5.
 *
 * A chain records, in order:
 *   company context version → marketing goal → audience persona → roadmap entry
 *   → hypothesis → post variant → published record → analytics report
 *   → experiment evaluation
 *
 * Property 28: every link reached so far carries a non-null entity ID and
 * timestamp, unreached links are absent, and the status is `in_progress` or
 * `partial` until the final link lands. Links are stored in canonical stage
 * order regardless of the order they were recorded in, so a chain read back mid
 * lifecycle is always a prefix of the full sequence.
 *
 * Everything is held in memory and lookups are O(1) by variant id, which is what
 * meets the ≤ 3 second query SLA in Requirement 13.2.
 */
import { randomUUID } from "node:crypto";
import type {
  TraceabilityChain,
  TraceabilityLink,
} from "../types/index.js";

/** Canonical link order (Requirement 13.1). */
export const TRACE_STAGES = [
  "companyContextVersion",
  "marketingGoal",
  "audiencePersona",
  "roadmapEntry",
  "hypothesis",
  "postVariant",
  "publishedRecord",
  "analyticsReport",
  "experimentEvaluation",
] as const;

export type TraceStage = (typeof TRACE_STAGES)[number];

/** The links required before a chain counts as complete. */
const TERMINAL_STAGE: TraceStage = "experimentEvaluation";

/** Maps a stage to its named field on `TraceabilityChain`. */
const CHAIN_FIELD: Record<TraceStage, keyof TraceabilityChain> = {
  companyContextVersion: "companyContextVersionId",
  marketingGoal: "marketingGoalId",
  audiencePersona: "audiencePersonaId",
  roadmapEntry: "roadmapEntryId",
  hypothesis: "hypothesisId",
  postVariant: "postVariantId",
  publishedRecord: "publishedRecordId",
  analyticsReport: "analyticsReportId",
  experimentEvaluation: "experimentEvaluationId",
};

/** Records a human edit for audit (Requirement 13.4). */
export interface HumanEditEvent {
  id: string;
  postVariantId: string;
  /** Who made the edit. */
  actor: string;
  timestamp: string;
  /** The AI-generated version prior to the edit. */
  originalVersion: unknown;
  /** The version after the human edit. */
  editedVersion: unknown;
  /** Which fields changed, when the caller supplies them. */
  changedFields?: string[];
}

export interface TraceabilityQueryResult {
  chain: TraceabilityChain;
  status: TraceabilityChain["status"];
  humanEdits: HumanEditEvent[];
  /** Stages not yet reached — absent from `chain.links`. */
  missingStages: TraceStage[];
  /** Wall-clock cost of the lookup, for the 3s SLA in Requirement 13.2. */
  durationMs: number;
}

/**
 * Requirement 13.3 — globally unique identifiers assigned at creation time for
 * Hypothesis, PostVariant, Experiment and ExperimentEvaluation records.
 */
export function newEntityId(): string {
  return randomUUID();
}

export const newHypothesisId = newEntityId;
export const newPostVariantId = newEntityId;
export const newExperimentId = newEntityId;
export const newExperimentEvaluationId = newEntityId;

/** True for a v4 UUID as produced by `newEntityId`. */
export function isGloballyUniqueId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

interface StoredLink {
  stage: TraceStage;
  entityId: string;
  timestamp: string;
}

/**
 * Builds and incrementally updates traceability chains, one per Post_Variant.
 */
export class TraceabilityBuilder {
  private readonly links = new Map<string, Map<TraceStage, StoredLink>>();
  private readonly edits = new Map<string, HumanEditEvent[]>();

  /**
   * Record (or overwrite) one link. Timestamps default to now; an explicit
   * timestamp is preserved so backfilled links keep their real creation time.
   */
  record(
    postVariantId: string,
    stage: TraceStage,
    entityId: string,
    timestamp: string = new Date().toISOString(),
  ): this {
    if (!entityId) {
      throw new Error(`Traceability link ${stage} requires a non-empty entityId`);
    }
    let chain = this.links.get(postVariantId);
    if (!chain) {
      chain = new Map();
      this.links.set(postVariantId, chain);
    }
    chain.set(stage, { stage, entityId, timestamp });
    return this;
  }

  /** Record several links at once, in canonical order. */
  recordAll(
    postVariantId: string,
    entries: Partial<Record<TraceStage, string>>,
  ): this {
    for (const stage of TRACE_STAGES) {
      const entityId = entries[stage];
      if (entityId) this.record(postVariantId, stage, entityId);
    }
    return this;
  }

  /**
   * Record a human edit (Requirement 13.4), capturing actor, timestamp and both
   * the original AI-generated and the human-edited versions.
   */
  recordHumanEdit(
    event: Omit<HumanEditEvent, "id" | "timestamp"> &
      Partial<Pick<HumanEditEvent, "id" | "timestamp">>,
  ): HumanEditEvent {
    const full: HumanEditEvent = {
      id: event.id ?? randomUUID(),
      postVariantId: event.postVariantId,
      actor: event.actor,
      timestamp: event.timestamp ?? new Date().toISOString(),
      originalVersion: event.originalVersion,
      editedVersion: event.editedVersion,
      changedFields: event.changedFields,
    };
    const list = this.edits.get(full.postVariantId);
    if (list) list.push(full);
    else this.edits.set(full.postVariantId, [full]);
    return full;
  }

  humanEdits(postVariantId: string): HumanEditEvent[] {
    return [...(this.edits.get(postVariantId) ?? [])];
  }

  has(postVariantId: string): boolean {
    return this.links.has(postVariantId);
  }

  /** Every variant with at least one recorded link. */
  variantIds(): string[] {
    return [...this.links.keys()];
  }

  /**
   * Build the chain for a variant.
   *
   * `complete` requires the terminal evaluation link; `partial` means some links
   * are present but the chain stops short; `in_progress` means nothing beyond
   * the variant itself has happened yet (Requirement 13.5).
   */
  build(postVariantId: string): TraceabilityQueryResult {
    const startedAt = Date.now();
    const stored = this.links.get(postVariantId) ?? new Map<TraceStage, StoredLink>();

    // Canonical order, skipping unreached stages.
    const links: TraceabilityLink[] = [];
    const missingStages: TraceStage[] = [];
    for (const stage of TRACE_STAGES) {
      const link = stored.get(stage);
      if (link) {
        links.push({
          entityType: stage,
          entityId: link.entityId,
          timestamp: link.timestamp,
        });
      } else {
        missingStages.push(stage);
      }
    }

    const status: TraceabilityChain["status"] = stored.has(TERMINAL_STAGE)
      ? "complete"
      : links.length > 0 &&
          TRACE_STAGES.slice(TRACE_STAGES.indexOf("publishedRecord")).some((s) =>
            stored.has(s),
          )
        ? "partial"
        : "in_progress";

    const chain: TraceabilityChain = {
      companyContextVersionId: stored.get("companyContextVersion")?.entityId ?? "",
      marketingGoalId: stored.get("marketingGoal")?.entityId ?? "",
      audiencePersonaId: stored.get("audiencePersona")?.entityId ?? "",
      roadmapEntryId: stored.get("roadmapEntry")?.entityId ?? "",
      hypothesisId: stored.get("hypothesis")?.entityId ?? "",
      postVariantId: stored.get("postVariant")?.entityId ?? postVariantId,
      publishedRecordId: stored.get("publishedRecord")?.entityId,
      analyticsReportId: stored.get("analyticsReport")?.entityId,
      experimentEvaluationId: stored.get("experimentEvaluation")?.entityId,
      status,
      links,
    };

    return {
      chain,
      status,
      humanEdits: this.humanEdits(postVariantId),
      missingStages,
      durationMs: Date.now() - startedAt,
    };
  }

  /** Drop a variant's chain and edits. */
  clear(postVariantId?: string): void {
    if (postVariantId === undefined) {
      this.links.clear();
      this.edits.clear();
      return;
    }
    this.links.delete(postVariantId);
    this.edits.delete(postVariantId);
  }
}

/**
 * Structural check mirroring Property 28: every present link has a non-null id
 * and timestamp, links appear in canonical order, and the status agrees with how
 * far the chain actually reaches.
 */
export function validateChain(chain: TraceabilityChain): {
  valid: boolean;
  problems: string[];
} {
  const problems: string[] = [];

  let lastIndex = -1;
  for (const link of chain.links) {
    if (!link.entityId) problems.push(`link ${link.entityType} has an empty entityId`);
    if (!link.timestamp) problems.push(`link ${link.entityType} has no timestamp`);
    else if (Number.isNaN(Date.parse(link.timestamp))) {
      problems.push(`link ${link.entityType} has an unparseable timestamp`);
    }

    const index = (TRACE_STAGES as readonly string[]).indexOf(link.entityType);
    if (index === -1) {
      problems.push(`link ${link.entityType} is not a known trace stage`);
    } else if (index <= lastIndex) {
      problems.push(`link ${link.entityType} is out of canonical order`);
    } else {
      lastIndex = index;
    }
  }

  const hasEvaluation = chain.links.some(
    (l) => l.entityType === "experimentEvaluation",
  );
  if (hasEvaluation && chain.status !== "complete") {
    problems.push("chain reaches the evaluation link but is not marked complete");
  }
  if (!hasEvaluation && chain.status === "complete") {
    problems.push("chain is marked complete without an evaluation link");
  }

  // Named id fields must agree with the links they mirror.
  for (const stage of TRACE_STAGES) {
    const link = chain.links.find((l) => l.entityType === stage);
    const field = CHAIN_FIELD[stage];
    const value = chain[field];
    if (link && value !== link.entityId && stage !== "postVariant") {
      problems.push(`${String(field)} does not match the ${stage} link`);
    }
  }

  return { valid: problems.length === 0, problems };
}

/** Process-wide builder, shared by the API routes. */
export const traceability = new TraceabilityBuilder();
