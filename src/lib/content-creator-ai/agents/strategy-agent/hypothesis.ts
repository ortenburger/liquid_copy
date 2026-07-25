/**
 * Hypothesis generation (Task 6.6) — Requirements 7.1–7.7.
 *
 * Property 16: all seven fields are non-empty and at least one success metric
 * has a name and a numeric target — guaranteed by deterministic fallbacks
 * derived from the roadmap entry, goal and persona, so an absent LLM cannot
 * produce a hole.
 *
 * Property 17: generation refuses to emit a hypothesis when RAG returned 1 or 2
 * prior outcomes, reporting `insufficient_history` instead. Zero outcomes is
 * only allowed through on the first experiment cycle (Requirement 7.2).
 *
 * Property 18: modification appends the original field values and creation
 * timestamp as an immutable versioned alternative.
 */
import { randomUUID } from "node:crypto";
import type {
  AudiencePersona,
  ContentPattern,
  Hypothesis,
  HypothesisVersion,
  MarketingGoal,
  RAGPassage,
  RoadmapEntry,
  SuccessMetric,
} from "../../types/index.js";
import { readKBEntity, writeKBEntity } from "../../kb/storage.js";
import {
  getLLMClient,
  parseJSONFromLLM,
  type LLMClient,
} from "../../integrations/llm.js";
import { retrieveGrounding, formatPassages } from "../shared/grounding.js";
import { DEFAULT_SUCCESS_METRIC } from "./goals.js";

/** Requirement 7.2 / Property 17. */
export const MIN_PRIOR_OUTCOMES = 3;

/** The seven fields Requirement 7.1 mandates. */
export const REQUIRED_HYPOTHESIS_FIELDS = [
  "hook", "angle", "coreCopy", "painPoint", "theme", "visualTheme", "successMetrics",
] as const;

export interface GenerateHypothesisOptions {
  roadmapEntry: RoadmapEntry;
  marketingGoal: MarketingGoal;
  audiencePersonas: AudiencePersona[];
  /**
   * First experiment cycle. Only when true may generation proceed with zero
   * prior outcomes (Requirement 7.2 exception).
   */
  firstCycle?: boolean;
  /** Patterns with priorityScore 0.0 to avoid (Requirement 7.3). */
  failedPatterns?: ContentPattern[];
  /** Pre-fetched passages; when omitted the RAG layer is queried. */
  ragPassages?: RAGPassage[];
  /** Extra constraints applied after a rejection (Requirement 7.7). */
  constraints?: string[];
  llm?: LLMClient;
  storagePath?: string;
  skipGrounding?: boolean;
}

export interface HypothesisConflict {
  pattern: ContentPattern;
  field: "hook" | "angle" | "visualTheme";
  message: string;
}

export type GenerateHypothesisResult =
  | {
      status: "generated";
      hypothesis: Hypothesis;
      priorOutcomeCount: number;
      /** Requirement 7.3: failed patterns this draft echoes. */
      conflicts: HypothesisConflict[];
      /** Alternative proposed when conflicts were found. */
      proposedAlternative?: Partial<Hypothesis>;
      contextTag?: string;
      warnings: string[];
    }
  | {
      status: "insufficient_history";
      priorOutcomeCount: number;
      message: string;
      warnings: string[];
    };

interface LLMHypothesisShape {
  hook?: string;
  angle?: string;
  coreCopy?: string;
  painPoint?: string;
  theme?: string;
  visualTheme?: string;
  successMetrics?: Array<{
    name?: string;
    numericTarget?: number | string;
    timePeriod?: string;
    direction?: string;
  }>;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/** A metric is usable when it names an indicator and targets a finite number. */
function coerceMetrics(
  raw: LLMHypothesisShape["successMetrics"],
  fallbackPeriod: string,
): SuccessMetric[] {
  if (!Array.isArray(raw)) return [];
  const out: SuccessMetric[] = [];
  for (const m of raw) {
    const name = nonEmpty(m?.name);
    const target =
      typeof m?.numericTarget === "string" ? Number(m.numericTarget) : m?.numericTarget;
    if (!name || typeof target !== "number" || !Number.isFinite(target)) continue;
    out.push({
      name,
      numericTarget: target,
      timePeriod: nonEmpty(m?.timePeriod) ?? fallbackPeriod,
      direction:
        m?.direction === "decrease" || m?.direction === "maintain"
          ? m.direction
          : "increase",
    });
  }
  return out;
}

/**
 * Structural check mirroring Property 16. Exported so callers and the API layer
 * can reject a malformed hypothesis without duplicating the rule.
 */
export function validateHypothesis(hypothesis: Partial<Hypothesis>): {
  valid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];
  for (const field of REQUIRED_HYPOTHESIS_FIELDS) {
    if (field === "successMetrics") continue;
    if (!nonEmpty(hypothesis[field])) missingFields.push(field);
  }
  const metrics = Array.isArray(hypothesis.successMetrics)
    ? hypothesis.successMetrics
    : [];
  const hasUsableMetric = metrics.some(
    (m) =>
      nonEmpty(m?.name) !== undefined &&
      typeof m?.numericTarget === "number" &&
      Number.isFinite(m.numericTarget),
  );
  if (!hasUsableMetric) missingFields.push("successMetrics");
  return { valid: missingFields.length === 0, missingFields };
}

/** Detect echoes of failed patterns (Requirement 7.3). */
export function detectFailedPatternConflicts(
  hypothesis: Pick<Hypothesis, "hook" | "angle" | "visualTheme">,
  failedPatterns: ContentPattern[],
): HypothesisConflict[] {
  const conflicts: HypothesisConflict[] = [];
  const fieldFor: Record<ContentPattern["type"], "hook" | "angle" | "visualTheme"> = {
    hook: "hook",
    angle: "angle",
    visual_theme: "visualTheme",
  };

  for (const pattern of failedPatterns) {
    // Only patterns explicitly scored as failures count (Requirement 11.5).
    if (pattern.priorityScore !== 0) continue;
    const field = fieldFor[pattern.type];
    const value = hypothesis[field];
    if (!value || !pattern.value?.trim()) continue;
    const a = value.toLowerCase();
    const b = pattern.value.toLowerCase();
    if (a === b || a.includes(b) || b.includes(a)) {
      conflicts.push({
        pattern,
        field,
        message: `The ${field} "${value}" matches a previously failed pattern from experiment ${pattern.experimentId}.`,
      });
    }
  }
  return conflicts;
}

/**
 * Read failed patterns (priority score 0.0) recorded against prior experiments.
 * Tolerates missing records — the Learning_Agent may not have run yet.
 */
export async function readFailedPatterns(
  experimentIds: string[],
  storagePath?: string,
): Promise<ContentPattern[]> {
  const patterns: ContentPattern[] = [];
  for (const experimentId of experimentIds) {
    try {
      const markdown = await readKBEntity(experimentId, storagePath);
      if (!markdown) continue;
      const section = markdown.match(
        /###\s*FailedPatterns\s*\n([\s\S]*?)(?=\n###\s|\n##\s|\n#\s|$)/i,
      )?.[1];
      if (!section) continue;
      for (const line of section.split("\n")) {
        // Format: `- hook: value` (written by the Learning_Agent).
        const m = line.match(/^\s*-\s*(hook|angle|visual_theme)\s*:\s*(.+)$/i);
        if (!m) continue;
        patterns.push({
          patternId: randomUUID(),
          type: m[1].toLowerCase() as ContentPattern["type"],
          value: m[2].trim(),
          priorityScore: 0,
          experimentId,
          recencyWeight: 0,
        });
      }
    } catch {
      continue;
    }
  }
  return patterns;
}

/**
 * Generate a Hypothesis for a roadmap slot.
 *
 * Returns `insufficient_history` when RAG yields 1–2 prior outcomes, or zero
 * outcomes outside the first cycle (Requirement 7.2 / Property 17).
 */
export async function generateHypothesis(
  options: GenerateHypothesisOptions,
): Promise<GenerateHypothesisResult> {
  const warnings: string[] = [];
  const { roadmapEntry, marketingGoal, audiencePersonas } = options;

  // Requirement 7.2: query prior outcomes before generating.
  let passages: RAGPassage[] = options.ragPassages ?? [];
  let contextTag: string | undefined;
  if (!options.ragPassages && !options.skipGrounding) {
    const grounding = await retrieveGrounding({
      query: `prior experiment outcomes, winning hooks and audience learnings for ${roadmapEntry.theme}`,
      scope: "experiment_history",
    });
    passages = grounding.passages;
    contextTag = grounding.contextTag;
  } else if (passages.length === 0) {
    contextTag = "generated without retrieved context";
  }

  const priorOutcomeCount = passages.length;
  const firstCycle = options.firstCycle === true;

  if (priorOutcomeCount < MIN_PRIOR_OUTCOMES) {
    const zeroOnFirstCycle = priorOutcomeCount === 0 && firstCycle;
    if (!zeroOnFirstCycle) {
      return {
        status: "insufficient_history",
        priorOutcomeCount,
        message:
          `Hypothesis generation needs at least ${MIN_PRIOR_OUTCOMES} prior experiment outcomes; ` +
          `the knowledge base returned ${priorOutcomeCount}. Waiting for more experiment history.`,
        warnings,
      };
    }
  }

  const persona = audiencePersonas[0];
  const fallbackPeriod =
    roadmapEntry.successMetrics[0]?.timePeriod ??
    marketingGoal.successMetrics[0]?.timePeriod ??
    DEFAULT_SUCCESS_METRIC.timePeriod;

  // Deterministic baseline for all seven fields (Property 16).
  let hook = `A better way to handle ${persona?.painPoints?.[0] ?? roadmapEntry.theme}`;
  let angle = roadmapEntry.theme || marketingGoal.primaryObjective;
  let coreCopy =
    `${persona?.icpDefinition ?? "Our audience"} struggles with ` +
    `${persona?.painPoints?.[0] ?? "this problem"}. ${marketingGoal.primaryObjective}.`;
  let painPoint = persona?.painPoints?.[0] ?? roadmapEntry.theme;
  let theme = roadmapEntry.theme || marketingGoal.primaryObjective;
  let visualTheme = `Clean, high-contrast visuals for week ${roadmapEntry.weekNumber}`;
  let successMetrics: SuccessMetric[] =
    roadmapEntry.successMetrics.length > 0
      ? roadmapEntry.successMetrics
      : marketingGoal.successMetrics.length > 0
        ? marketingGoal.successMetrics
        : [{ ...DEFAULT_SUCCESS_METRIC }];

  const failedPatterns = options.failedPatterns ?? [];
  const llm = options.llm ?? getLLMClient();
  const raw = await llm.complete(
    `Write one testable social content hypothesis.\n` +
      `Reply with JSON only: { "hook", "angle", "coreCopy", "painPoint", "theme", "visualTheme", "successMetrics": [{ "name", "numericTarget", "timePeriod", "direction" }] }.\n` +
      `All seven fields are required and must be non-empty.\n\n` +
      `Week ${roadmapEntry.weekNumber} theme: ${roadmapEntry.theme}\n` +
      `Business objective: ${roadmapEntry.businessObjectiveRef}\n` +
      `Goal: ${marketingGoal.primaryObjective} on ${marketingGoal.targetPlatform}\n` +
      (persona
        ? `Audience: ${persona.icpDefinition}\nPain points: ${persona.painPoints.join("; ")}\n`
        : "") +
      (failedPatterns.length > 0
        ? `Avoid these previously failed patterns: ${failedPatterns.map((p) => `${p.type}="${p.value}"`).join(", ")}\n`
        : "") +
      (options.constraints?.length
        ? `Additional constraints from the operator: ${options.constraints.join("; ")}\n`
        : "") +
      (passages.length > 0 ? `\nPrior outcomes:\n${formatPassages(passages)}\n` : ""),
    { temperature: 0.4 },
  );

  const parsed = parseJSONFromLLM<LLMHypothesisShape>(raw);
  if (parsed) {
    hook = nonEmpty(parsed.hook) ?? hook;
    angle = nonEmpty(parsed.angle) ?? angle;
    coreCopy = nonEmpty(parsed.coreCopy) ?? coreCopy;
    painPoint = nonEmpty(parsed.painPoint) ?? painPoint;
    theme = nonEmpty(parsed.theme) ?? theme;
    visualTheme = nonEmpty(parsed.visualTheme) ?? visualTheme;
    const metrics = coerceMetrics(parsed.successMetrics, fallbackPeriod);
    if (metrics.length > 0) successMetrics = metrics;
  } else if (raw !== null) {
    warnings.push("LLM hypothesis draft was unparseable; used derived defaults");
  }

  const hypothesis: Hypothesis = {
    id: randomUUID(),
    hook,
    angle,
    coreCopy,
    painPoint,
    theme,
    visualTheme,
    successMetrics,
    roadmapEntryId: roadmapEntry.id,
    goalId: marketingGoal.id,
    status: "draft",
    kbStorageStatus: "failed", // set to "persisted" once a write confirms
    createdAt: new Date().toISOString(),
    versions: [],
  };

  // Self-check so Property 16 holds even if a fallback was itself blank.
  const validation = validateHypothesis(hypothesis);
  if (!validation.valid) {
    if (!nonEmpty(hypothesis.hook)) hypothesis.hook = `Week ${roadmapEntry.weekNumber} hook`;
    if (!nonEmpty(hypothesis.angle)) hypothesis.angle = `Week ${roadmapEntry.weekNumber} angle`;
    if (!nonEmpty(hypothesis.coreCopy)) hypothesis.coreCopy = marketingGoal.primaryObjective || "Core message";
    if (!nonEmpty(hypothesis.painPoint)) hypothesis.painPoint = "Unspecified audience pain point";
    if (!nonEmpty(hypothesis.theme)) hypothesis.theme = `Week ${roadmapEntry.weekNumber} theme`;
    if (!nonEmpty(hypothesis.visualTheme)) hypothesis.visualTheme = "Clean, high-contrast visuals";
    if (validation.missingFields.includes("successMetrics")) {
      hypothesis.successMetrics = [{ ...DEFAULT_SUCCESS_METRIC }];
    }
    warnings.push(`Repaired hypothesis fields: ${validation.missingFields.join(", ")}`);
  }

  const conflicts = detectFailedPatternConflicts(hypothesis, failedPatterns);
  const proposedAlternative =
    conflicts.length > 0 ? proposeAlternative(hypothesis, conflicts) : undefined;

  return {
    status: "generated",
    hypothesis,
    priorOutcomeCount,
    conflicts,
    proposedAlternative,
    contextTag,
    warnings,
  };
}

/** Suggest replacements for fields that echo a failed pattern (Requirement 7.3). */
export function proposeAlternative(
  hypothesis: Hypothesis,
  conflicts: HypothesisConflict[],
): Partial<Hypothesis> {
  const alternative: Partial<Hypothesis> = {};
  for (const conflict of conflicts) {
    switch (conflict.field) {
      case "hook":
        alternative.hook = `Instead of "${hypothesis.hook}", lead with a concrete outcome for ${hypothesis.painPoint}`;
        break;
      case "angle":
        alternative.angle = `Reframe "${hypothesis.angle}" as a customer story rather than a claim`;
        break;
      case "visualTheme":
        alternative.visualTheme = `Replace "${hypothesis.visualTheme}" with a contrasting visual treatment`;
        break;
    }
  }
  return alternative;
}

// ---- Review actions (Requirements 7.5, 7.6, 7.7) ----

export interface ApproveHypothesisResult {
  hypothesis: Hypothesis;
  /** Approval always succeeds; only persistence can fail (Requirement 7.5). */
  approved: true;
  persisted: boolean;
  kbVersion?: string;
  /** Shown when the KB write failed but approval still stood. */
  warning?: string;
}

/**
 * Approve a hypothesis. Requirement 7.5 is explicit that a KB write failure must
 * NOT block approval — it downgrades to a warning, unlike the goal/roadmap path
 * where storage gates scheduling.
 */
export async function approveHypothesis(
  hypothesis: Hypothesis,
  options: { storagePath?: string } = {},
): Promise<ApproveHypothesisResult> {
  const approved: Hypothesis = { ...hypothesis, status: "approved" };
  try {
    const written = await writeKBEntity(
      {
        entityId: `hypothesis-${approved.id}`,
        entityType: "experiment",
        content: renderHypothesisMarkdown(approved),
        author: "user",
      },
      options.storagePath,
    );
    approved.kbStorageStatus = "persisted";
    return {
      hypothesis: approved,
      approved: true,
      persisted: true,
      kbVersion: written.version.versionId,
    };
  } catch (err) {
    approved.kbStorageStatus = "failed";
    const reason = err instanceof Error ? err.message : String(err);
    return {
      hypothesis: approved,
      approved: true,
      persisted: false,
      warning: `Hypothesis ${approved.id} was approved but could not be saved to the knowledge base (${reason}). It will be retried in the background.`,
    };
  }
}

/** Fields captured when archiving a hypothesis as a versioned alternative. */
const VERSIONED_FIELDS = [
  "hook", "angle", "coreCopy", "painPoint", "theme", "visualTheme", "successMetrics",
] as const;

/**
 * Apply operator edits, archiving the pre-edit field values and the original
 * creation timestamp as an immutable versioned alternative (Property 18).
 */
export function modifyHypothesis(
  hypothesis: Hypothesis,
  edits: Partial<
    Pick<
      Hypothesis,
      "hook" | "angle" | "coreCopy" | "painPoint" | "theme" | "visualTheme" | "successMetrics"
    >
  >,
): Hypothesis {
  const archived: HypothesisVersion = {
    versionId: randomUUID(),
    fields: {
      ...Object.fromEntries(
        VERSIONED_FIELDS.map((f) => [f, hypothesis[f]]),
      ),
      // Retaining the original creation timestamp is part of Property 18.
      createdAt: hypothesis.createdAt,
      status: hypothesis.status,
    },
    timestamp: hypothesis.createdAt,
  };

  const modified: Hypothesis = {
    ...hypothesis,
    ...edits,
    status: "modified",
    // Append-only: earlier alternatives are never rewritten or dropped.
    versions: [...hypothesis.versions, archived],
  };
  return modified;
}

export interface RejectHypothesisResult {
  discardedId: string;
  notification: string;
  /** The replacement draft, generated with the operator's revised constraints. */
  replacement: GenerateHypothesisResult;
}

/**
 * Reject a draft: discard it, notify, and generate a replacement under revised
 * constraints (Requirement 7.7). The rejected draft is never written to the KB.
 */
export async function rejectHypothesis(
  hypothesis: Hypothesis,
  options: GenerateHypothesisOptions & { instructions?: string },
): Promise<RejectHypothesisResult> {
  const constraints = [
    ...(options.constraints ?? []),
    ...(options.instructions ? [options.instructions] : []),
    `Do not reuse the rejected hook "${hypothesis.hook}" or angle "${hypothesis.angle}".`,
  ];

  const replacement = await generateHypothesis({ ...options, constraints });
  return {
    discardedId: hypothesis.id,
    notification: `Hypothesis ${hypothesis.id} was rejected and discarded. A new draft has been generated with your revised constraints.`,
    replacement,
  };
}

/** Render a hypothesis into the Experiments section of the KB Markdown schema. */
export function renderHypothesisMarkdown(hypothesis: Hypothesis): string {
  return [
    "# Company_Identity", "", "_empty_", "",
    "# Products", "", "_empty_", "",
    "# Audiences", "", "_empty_", "",
    "# Experiments", "",
    `## ${hypothesis.id}`, "",
    "### Hypothesis", hypothesis.id, "",
    "### Hook", hypothesis.hook, "",
    "### Angle", hypothesis.angle, "",
    "### CoreCopy", hypothesis.coreCopy, "",
    "### PainPoint", hypothesis.painPoint, "",
    "### Theme", hypothesis.theme, "",
    "### VisualTheme", hypothesis.visualTheme, "",
    "### SuccessMetrics",
    hypothesis.successMetrics
      .map((m) => `- ${m.name}: ${m.direction} to ${m.numericTarget} over ${m.timePeriod}`)
      .join("\n") || "_none_",
    "",
    "### RoadmapEntryId", hypothesis.roadmapEntryId, "",
    "### GoalId", hypothesis.goalId, "",
    "### Status", hypothesis.status, "",
    "### VersionCounter", String(hypothesis.versions.length), "",
    "### CreatedAt", hypothesis.createdAt, "",
  ].join("\n");
}
