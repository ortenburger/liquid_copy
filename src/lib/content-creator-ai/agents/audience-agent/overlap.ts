/**
 * Persona overlap detection and merging (Task 7.2) — Requirements 4.1, 4.6, 4.7.
 *
 * Similarity metric (design: "field-level Jaccard similarity across all string
 * fields, computed pairwise"): each persona reduces to the SET of its normalised
 * content-field values — `icpDefinition` plus every entry of `painPoints`,
 * `jobsToBeDone`, `objections` and `dreamOutcomes`. Similarity is
 * |A ∩ B| / |A ∪ B|.
 *
 * Identity metadata (`id`, `source`, `kbVersion`, `createdAt`) is deliberately
 * excluded — two personas describing the same audience must not read as distinct
 * merely because their UUIDs differ.
 *
 * Two personas with no content at all yield 0, not 1: there is no evidence of
 * overlap to act on, and such personas fail validation anyway. Property 12's
 * "if and only if" is evaluated against exactly this definition.
 */
import { randomUUID } from "node:crypto";
import type { AudiencePersona } from "../../types/index.js";
import { eventBus } from "../../orchestration/event-bus.js";
import {
  validatePersona,
  type PersonaValidationResult,
} from "./persona-validation.js";

/** Requirement 4.1: any two proposed personas must share fewer than 60%. */
export const OVERLAP_THRESHOLD = 0.6;

/** Content fields that participate in the similarity computation. */
export const PERSONA_CONTENT_FIELDS = [
  "icpDefinition",
  "painPoints",
  "jobsToBeDone",
  "objections",
  "dreamOutcomes",
] as const;

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Reduce a persona to the set of its normalised content values.
 * Values are namespaced by field so the same phrase under different fields does
 * not read as a match.
 */
export function personaFieldValues(
  persona: Partial<AudiencePersona>,
): Set<string> {
  const values = new Set<string>();
  for (const field of PERSONA_CONTENT_FIELDS) {
    const raw = persona[field];
    if (typeof raw === "string") {
      const n = normalise(raw);
      if (n) values.add(`${field}:${n}`);
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item !== "string") continue;
        const n = normalise(item);
        if (n) values.add(`${field}:${n}`);
      }
    }
  }
  return values;
}

/** Jaccard similarity over persona content values. 0 when both sets are empty. */
export function jaccardSimilarity(
  a: Partial<AudiencePersona>,
  b: Partial<AudiencePersona>,
): number {
  const setA = personaFieldValues(a);
  const setB = personaFieldValues(b);
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  for (const value of setA) if (setB.has(value)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** True exactly when the pair reaches the 60% threshold (Property 12). */
export function shouldAlertOverlap(
  a: Partial<AudiencePersona>,
  b: Partial<AudiencePersona>,
): boolean {
  return jaccardSimilarity(a, b) >= OVERLAP_THRESHOLD;
}

export interface OverlapPair {
  a: AudiencePersona;
  b: AudiencePersona;
  similarity: number;
  /** True when similarity ≥ 0.6. */
  alert: boolean;
}

/** Similarity for every unordered pair in the set. */
export function computePairwiseOverlap(
  personas: AudiencePersona[],
): OverlapPair[] {
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < personas.length; i++) {
    for (let j = i + 1; j < personas.length; j++) {
      const similarity = jaccardSimilarity(personas[i], personas[j]);
      pairs.push({
        a: personas[i],
        b: personas[j],
        similarity,
        alert: similarity >= OVERLAP_THRESHOLD,
      });
    }
  }
  return pairs;
}

/** Pairs at or above the threshold — candidates for merge-or-keep-both (4.6). */
export function findDuplicatePairs(
  personas: AudiencePersona[],
): OverlapPair[] {
  return computePairwiseOverlap(personas).filter((p) => p.alert);
}

/** True when every pair is below the threshold (Property 10). */
export function isDistinctSet(personas: AudiencePersona[]): boolean {
  return computePairwiseOverlap(personas).every((p) => !p.alert);
}

export interface DuplicationAlert {
  pair: OverlapPair;
  message: string;
  options: readonly ["merge", "keep_both"];
}

/**
 * Build the operator-facing duplication alerts for a persona set
 * (Requirement 4.6). Also emits a checkpoint event so a UI subscribed to the
 * Event Bus can surface them without polling.
 */
export async function alertOnDuplicates(
  personas: AudiencePersona[],
  options: { emitEvent?: boolean } = {},
): Promise<DuplicationAlert[]> {
  const alerts: DuplicationAlert[] = findDuplicatePairs(personas).map((pair) => ({
    pair,
    message:
      `Personas ${pair.a.id} and ${pair.b.id} share ` +
      `${Math.round(pair.similarity * 100)}% of their field values. Merge them or keep both?`,
    options: ["merge", "keep_both"] as const,
  }));

  if (alerts.length > 0 && options.emitEvent !== false) {
    await eventBus.publish("checkpoint.reached", {
      stage: "AudienceReview",
      pendingOutput: {
        kind: "persona_duplication",
        alerts: alerts.map((a) => ({
          aId: a.pair.a.id,
          bId: a.pair.b.id,
          similarity: a.pair.similarity,
          message: a.message,
        })),
      },
    });
  }

  return alerts;
}

export interface PersonaMergeResult {
  merged: AudiencePersona;
  sourceIds: [string, string];
  validation: PersonaValidationResult;
}

/** Union of two string lists, de-duplicated case-insensitively, order-stable. */
function unionList(a: unknown, b: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = normalise(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/** Combine two scalar strings so neither source's content is lost. */
function unionScalar(a: string | undefined, b: string | undefined): string {
  const left = a?.trim() ?? "";
  const right = b?.trim() ?? "";
  if (!left) return right;
  if (!right) return left;
  if (normalise(left) === normalise(right)) return left;
  return `${left} / ${right}`;
}

/**
 * Merge two personas into the union of their unique field values
 * (Requirement 4.7 / Property 13) and re-validate the result against the
 * minimum requirements.
 */
export function mergePersonas(
  a: AudiencePersona,
  b: AudiencePersona,
): PersonaMergeResult {
  const merged: AudiencePersona = {
    id: randomUUID(),
    icpDefinition: unionScalar(a.icpDefinition, b.icpDefinition),
    painPoints: unionList(a.painPoints, b.painPoints),
    jobsToBeDone: unionList(a.jobsToBeDone, b.jobsToBeDone),
    objections: unionList(a.objections, b.objections),
    dreamOutcomes: unionList(a.dreamOutcomes, b.dreamOutcomes),
    source: "merged",
    // Later of the two, so the merged record is not backdated.
    kbVersion: a.kbVersion || b.kbVersion,
    createdAt: new Date().toISOString(),
  };

  return {
    merged,
    sourceIds: [a.id, b.id],
    validation: validatePersona(merged),
  };
}
