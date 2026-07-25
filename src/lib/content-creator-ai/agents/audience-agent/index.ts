/**
 * Audience_Agent — persona research, review paths, KB persistence (Task 7.4).
 * Requirements 4.1–4.7.
 *
 * Property 10: the proposed set always holds 2–5 personas with every pair below
 * 0.6 similarity. Candidates (LLM or template-derived) are admitted one at a time
 * and only when they stay below the threshold against everything already
 * admitted; if that leaves fewer than two, disjoint deterministic templates top
 * the set up. Distinctness is therefore a property of the constructor, not a
 * post-hoc check that might fail.
 *
 * Requirement 4.1 also bounds research at 30 seconds, enforced by a deadline
 * that falls back to templates rather than returning nothing.
 */
import { randomUUID } from "node:crypto";
import type {
  AudiencePersona,
  CompanyIdentity,
  MarketingGoal,
} from "../../types/index.js";
import { writeKBEntity, readKBEntity } from "../../kb/storage.js";
import { parseFromMarkdown } from "../../kb/markdown.js";
import {
  getLLMClient,
  parseJSONFromLLM,
  type LLMClient,
} from "../../integrations/llm.js";
import { retrieveGrounding } from "../shared/grounding.js";
import {
  validatePersona,
  describeMissingPersonaFields,
  type PersonaValidationResult,
} from "./persona-validation.js";
import {
  OVERLAP_THRESHOLD,
  alertOnDuplicates,
  isDistinctSet,
  jaccardSimilarity,
  mergePersonas,
  type DuplicationAlert,
  type PersonaMergeResult,
} from "./overlap.js";

export const MIN_PERSONAS = 2;
export const MAX_PERSONAS = 5;
/** Requirement 4.1. */
export const RESEARCH_DEADLINE_MS = 30_000;

export interface ProposePersonasOptions {
  goal: MarketingGoal;
  identity?: CompanyIdentity;
  /** Desired count, clamped to 2–5. */
  count?: number;
  /** Research budget; defaults to 30s (Requirement 4.1). */
  deadlineMs?: number;
  llm?: LLMClient;
  skipGrounding?: boolean;
}

export interface ProposePersonasResult {
  personas: AudiencePersona[];
  /** Always true — retained so callers can assert the invariant cheaply. */
  distinct: boolean;
  durationMs: number;
  contextTag?: string;
  warnings: string[];
}

export interface PersonaStoreResult {
  persona?: AudiencePersona;
  stored: boolean;
  validation: PersonaValidationResult;
  kbVersion?: string;
  /** Operator-facing message when validation or storage failed. */
  message?: string;
}

interface LLMPersonaShape {
  icpDefinition?: string;
  painPoints?: string[];
  jobsToBeDone?: string[];
  objections?: string[];
  dreamOutcomes?: string[];
}

function cleanList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Five mutually disjoint persona templates. Because no two share a field value,
 * their pairwise Jaccard similarity is exactly 0 — which is what lets the
 * proposer guarantee Property 10 even with no LLM available.
 */
function templatePersonas(
  goal: MarketingGoal,
  identity?: CompanyIdentity,
): AudiencePersona[] {
  const domain = identity?.industry ?? "the market";
  const offering = identity?.products?.[0]?.name ?? identity?.name ?? "the product";

  const specs: Array<Omit<AudiencePersona, "id" | "source" | "kbVersion" | "createdAt">> = [
    {
      icpDefinition: `Time-poor founders in ${domain} running marketing themselves`,
      painPoints: ["no time to produce content consistently"],
      jobsToBeDone: ["ship a week of content in one sitting"],
      objections: ["another tool means another learning curve"],
      dreamOutcomes: ["a repeatable weekly publishing rhythm"],
    },
    {
      icpDefinition: `In-house marketing managers scaling ${offering} campaigns`,
      painPoints: ["creative output cannot keep pace with the campaign calendar"],
      jobsToBeDone: ["prove channel ROI to leadership"],
      objections: ["worried automated copy will drift off-brand"],
      dreamOutcomes: ["defensible reporting on what actually drove pipeline"],
    },
    {
      icpDefinition: `Freelance social media consultants serving several ${domain} clients`,
      painPoints: ["repeating the same manual setup for every client"],
      jobsToBeDone: ["hand clients a clear experiment summary"],
      objections: ["needs white-label output before recommending it"],
      dreamOutcomes: ["taking on more retainers without more hours"],
    },
    {
      icpDefinition: `Community-led operators growing an audience around ${offering}`,
      painPoints: ["engagement plateaued despite steady posting"],
      jobsToBeDone: ["find which hooks actually restart growth"],
      objections: ["sceptical that testing applies at small follower counts"],
      dreamOutcomes: ["compounding reach from a durable content formula"],
    },
    {
      icpDefinition: `Performance marketers buying paid social in ${domain}`,
      painPoints: ["creative fatigue drives acquisition cost up every quarter"],
      jobsToBeDone: ["source fresh creative angles fast enough to matter"],
      objections: ["must integrate with existing attribution reporting"],
      dreamOutcomes: ["a steady supply of tested, high-performing creative"],
    },
  ];

  return specs.map((spec) => ({
    ...spec,
    id: randomUUID(),
    source: "ai_generated" as const,
    kbVersion: goal.kbVersion || "",
    createdAt: new Date().toISOString(),
  }));
}

/**
 * Admit candidates while every pair stays under the threshold.
 * First-come-first-served: an over-similar candidate is dropped, not reshaped.
 */
function admitDistinct(
  candidates: AudiencePersona[],
  limit: number,
  seed: AudiencePersona[] = [],
): AudiencePersona[] {
  const accepted = [...seed];
  for (const candidate of candidates) {
    if (accepted.length >= limit) break;
    if (!validatePersona(candidate).valid) continue;
    const clashes = accepted.some(
      (existing) => jaccardSimilarity(existing, candidate) >= OVERLAP_THRESHOLD,
    );
    if (!clashes) accepted.push(candidate);
  }
  return accepted;
}

export interface AudienceAgentOptions {
  llm?: LLMClient;
  storagePath?: string;
}

export class AudienceAgent {
  private readonly llm: LLMClient;
  private readonly storagePath?: string;

  constructor(options: AudienceAgentOptions = {}) {
    this.llm = options.llm ?? getLLMClient();
    this.storagePath = options.storagePath;
  }

  /**
   * Research and propose a distinct persona set.
   *
   * Does not touch the goal's KB record, so it can run concurrently with the
   * goal write started by `confirmGoal` (Requirement 3.3 / Task 7.4).
   */
  async proposePersonas(
    options: ProposePersonasOptions,
  ): Promise<ProposePersonasResult> {
    const startedAt = Date.now();
    const warnings: string[] = [];
    const deadlineMs = options.deadlineMs ?? RESEARCH_DEADLINE_MS;
    const target = Math.min(
      MAX_PERSONAS,
      Math.max(MIN_PERSONAS, options.count ?? 3),
    );

    let contextTag: string | undefined;
    if (!options.skipGrounding) {
      const grounding = await retrieveGrounding({
        query: `audience personas, pain points and objections for ${options.goal.primaryObjective}`,
        scope: "audience_learning",
      });
      contextTag = grounding.contextTag;
    }

    const remaining = (): number => deadlineMs - (Date.now() - startedAt);

    let llmCandidates: AudiencePersona[] = [];
    if (remaining() > 1_000) {
      const llm = options.llm ?? this.llm;
      const raw = await llm.complete(
        `Propose ${target} clearly distinct target audience personas.\n` +
          `Reply with JSON only: an array of { "icpDefinition": string, "painPoints": string[], "jobsToBeDone": string[], "objections": string[], "dreamOutcomes": string[] }.\n` +
          `Each persona needs an ICP definition and at least one pain point. Make them share as few field values as possible.\n\n` +
          `Goal: ${options.goal.primaryObjective} on ${options.goal.targetPlatform}\n` +
          (options.identity
            ? `Company: ${options.identity.name}\nIndustry: ${options.identity.industry ?? "unknown"}\nMission: ${options.identity.mission}\n`
            : ""),
        { temperature: 0.6, timeoutMs: Math.max(1_000, remaining()) },
      );
      const parsed = parseJSONFromLLM<LLMPersonaShape[]>(raw);
      if (Array.isArray(parsed)) {
        llmCandidates = parsed
          .map((p) => ({
            id: randomUUID(),
            icpDefinition:
              typeof p?.icpDefinition === "string" ? p.icpDefinition.trim() : "",
            painPoints: cleanList(p?.painPoints),
            jobsToBeDone: cleanList(p?.jobsToBeDone),
            objections: cleanList(p?.objections),
            dreamOutcomes: cleanList(p?.dreamOutcomes),
            source: "ai_generated" as const,
            kbVersion: options.goal.kbVersion || "",
            createdAt: new Date().toISOString(),
          }))
          .filter((p) => validatePersona(p).valid);
      } else if (raw !== null) {
        warnings.push("LLM persona proposal was unparseable; used templates");
      }
    } else {
      warnings.push(
        `Audience research budget of ${deadlineMs}ms was exhausted before generation; used templates`,
      );
    }

    let personas = admitDistinct(llmCandidates, target);

    // Top up with disjoint templates when the model gave too few distinct ones.
    if (personas.length < MIN_PERSONAS || personas.length < target) {
      const before = personas.length;
      personas = admitDistinct(
        templatePersonas(options.goal, options.identity),
        target,
        personas,
      );
      if (before < MIN_PERSONAS) {
        warnings.push(
          `Only ${before} distinct persona(s) came back from generation; topped up to ${personas.length} with templates`,
        );
      }
    }

    // Hard floor: the contract is 2–5, so never return fewer than 2.
    if (personas.length < MIN_PERSONAS) {
      warnings.push(
        "Could not construct two distinct personas; returning the template pair",
      );
      personas = templatePersonas(options.goal, options.identity).slice(
        0,
        MIN_PERSONAS,
      );
    }

    return {
      personas: personas.slice(0, MAX_PERSONAS),
      distinct: isDistinctSet(personas.slice(0, MAX_PERSONAS)),
      durationMs: Date.now() - startedAt,
      contextTag,
      warnings,
    };
  }

  /** Duplication alerts for a set, offering merge-or-keep-both (Req 4.6). */
  async checkDuplicates(
    personas: AudiencePersona[],
  ): Promise<DuplicationAlert[]> {
    return alertOnDuplicates(personas);
  }

  /** Merge two personas and re-validate the union (Req 4.7). */
  merge(a: AudiencePersona, b: AudiencePersona): PersonaMergeResult {
    return mergePersonas(a, b);
  }

  /**
   * Store an accepted persona (Requirement 4.3).
   *
   * Atomicity (Requirement 4.5): validation runs to completion first and the KB
   * snapshot is a single write, so a rejected persona touches storage not at all
   * and a failed write leaves no half-written record.
   */
  async acceptPersona(persona: AudiencePersona): Promise<PersonaStoreResult> {
    return this.store(persona, "user");
  }

  /**
   * Save an edit as the active persona, versioning the previous definition
   * (Requirement 4.4).
   */
  async editPersona(
    existing: AudiencePersona,
    edits: Partial<AudiencePersona>,
  ): Promise<PersonaStoreResult> {
    const updated: AudiencePersona = {
      ...existing,
      ...edits,
      id: existing.id,
      source: existing.source === "merged" ? "merged" : "user_created",
    };

    const validation = validatePersona(updated);
    if (!validation.valid) {
      return {
        stored: false,
        validation,
        message: describeMissingPersonaFields(validation),
      };
    }

    const before = existing as unknown as Record<string, unknown>;
    const after = updated as unknown as Record<string, unknown>;
    const modifiedFields = Object.keys(edits).filter(
      (key) =>
        JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
    );
    const priorValues: Record<string, unknown> = {};
    for (const field of modifiedFields) {
      priorValues[field] = before[field] ?? null;
    }

    return this.store(updated, "user", { modifiedFields, priorValues });
  }

  /**
   * Create a persona from operator input (Requirement 4.5). Invalid submissions
   * are rejected with the missing field names and nothing is written.
   */
  async createPersona(
    input: Partial<AudiencePersona>,
  ): Promise<PersonaStoreResult> {
    const persona: AudiencePersona = {
      id: input.id ?? randomUUID(),
      icpDefinition: input.icpDefinition ?? "",
      painPoints: input.painPoints ?? [],
      jobsToBeDone: input.jobsToBeDone ?? [],
      objections: input.objections ?? [],
      dreamOutcomes: input.dreamOutcomes ?? [],
      source: "user_created",
      kbVersion: input.kbVersion ?? "",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    const validation = validatePersona(persona);
    if (!validation.valid) {
      return {
        stored: false,
        validation,
        message: describeMissingPersonaFields(validation),
      };
    }
    return this.store(persona, "user");
  }

  /** Read a stored persona back out of the KB. */
  async readPersona(personaId: string): Promise<AudiencePersona | null> {
    const markdown = await readKBEntity(
      `persona-${personaId}`,
      this.storagePath,
    );
    if (!markdown) return null;
    const audiences = parseFromMarkdown(markdown).payload.audiences ?? [];
    return audiences[0] ?? null;
  }

  private async store(
    persona: AudiencePersona,
    author: "system" | "user",
    version?: { modifiedFields: string[]; priorValues: Record<string, unknown> },
  ): Promise<PersonaStoreResult> {
    const validation = validatePersona(persona);
    if (!validation.valid) {
      return {
        stored: false,
        validation,
        message: describeMissingPersonaFields(validation),
      };
    }

    try {
      const result = await writeKBEntity(
        {
          entityId: `persona-${persona.id}`,
          entityType: "audience",
          content: {
            audiences: [persona],
            products: [],
            experiments: [],
          },
          author,
          modifiedFields: version?.modifiedFields,
          priorValues: version?.priorValues,
        },
        this.storagePath,
      );
      return {
        persona: { ...persona, kbVersion: result.version.versionId },
        stored: true,
        validation,
        kbVersion: result.version.versionId,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        stored: false,
        validation,
        message: `Persona ${persona.id} could not be stored (${reason}); nothing was written.`,
      };
    }
  }
}
