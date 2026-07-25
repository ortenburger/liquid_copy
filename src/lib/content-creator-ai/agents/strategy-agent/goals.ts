/**
 * Marketing goal generation and confirmation — Requirements 3.1, 3.2, 3.3.
 *
 * Property 8: for any sufficient KB context, the generated goal carries a
 * non-empty primary objective, a target platform, and at least one measurable
 * success metric. The generator therefore validates its own output and repairs
 * it from deterministic defaults, so an absent or unhelpful LLM can never yield
 * an invalid goal.
 */
import { randomUUID } from "node:crypto";
import type {
  CompanyIdentity,
  MarketingGoal,
  SuccessMetric,
} from "../../types/index.js";
import type { SocialPlatform } from "../../types/enums.js";
import {
  getLLMClient,
  parseJSONFromLLM,
  type LLMClient,
} from "../../integrations/llm.js";
import { writeKBEntity } from "../../kb/storage.js";
import { retrieveGrounding } from "../shared/grounding.js";
import {
  assessCompanyContext,
  isMeasurableMetric,
  isSupportedPlatform,
  validateGeneratedGoal,
  validateGoal,
  type ContextSufficiency,
  type GoalValidationResult,
} from "./goal-validation.js";

/** Fallback metric guaranteeing Property 8's "at least one measurable metric". */
export const DEFAULT_SUCCESS_METRIC: SuccessMetric = {
  name: "engagement_rate",
  numericTarget: 5,
  timePeriod: "30d",
  direction: "increase",
};

/** Industry-to-platform heuristic used when the operator names no platform. */
const PLATFORM_BY_INDUSTRY: Array<[RegExp, SocialPlatform]> = [
  [/b2b|saas|software|consult|agency|recruit|finance|legal/i, "linkedin"],
  [/craft|handmade|jewel|art|print|decor/i, "etsy"],
  [/food|recipe|home|interior|wedding|fashion/i, "pinterest"],
  [/game|music|entertain|fitness|dance|beauty/i, "tiktok"],
];

export interface GenerateGoalOptions {
  identity: CompanyIdentity;
  /** Operator-chosen platform; overrides the industry heuristic. */
  targetPlatform?: SocialPlatform;
  llm?: LLMClient;
  /** Skip the RAG query (used by tests that assert pure generation). */
  skipGrounding?: boolean;
}

export interface GenerateGoalResult {
  goal?: MarketingGoal;
  /** Populated when context was insufficient (Requirement 3.7). */
  contextSufficiency: ContextSufficiency;
  /** Requirement 14.6 tag when generation ran without retrieved context. */
  contextTag?: string;
  warnings: string[];
}

/** Shape the LLM may return; every field is optional and validated. */
interface LLMGoalShape {
  primaryObjective?: string;
  targetPlatform?: string;
  successMetrics?: Array<{
    name?: string;
    numericTarget?: number | string;
    timePeriod?: string;
    direction?: string;
  }>;
}

function pickPlatform(identity: CompanyIdentity): SocialPlatform {
  const haystack = [identity.industry, ...(identity.values ?? []), identity.mission]
    .filter(Boolean)
    .join(" ");
  for (const [pattern, platform] of PLATFORM_BY_INDUSTRY) {
    if (pattern.test(haystack)) return platform;
  }
  return "instagram";
}

function coerceDirection(value: unknown): SuccessMetric["direction"] {
  return value === "decrease" || value === "maintain" ? value : "increase";
}

function coerceMetrics(raw: LLMGoalShape["successMetrics"]): SuccessMetric[] {
  if (!Array.isArray(raw)) return [];
  const metrics: SuccessMetric[] = [];
  for (const m of raw) {
    const numericTarget =
      typeof m?.numericTarget === "string"
        ? Number(m.numericTarget)
        : m?.numericTarget;
    const candidate: SuccessMetric = {
      name: typeof m?.name === "string" ? m.name.trim() : "",
      numericTarget: typeof numericTarget === "number" ? numericTarget : NaN,
      timePeriod: typeof m?.timePeriod === "string" ? m.timePeriod.trim() : "",
      direction: coerceDirection(m?.direction),
    };
    if (isMeasurableMetric(candidate)) metrics.push(candidate);
  }
  return metrics;
}

/**
 * Propose an initial marketing goal from KB company context.
 *
 * Returns `goal: undefined` with a message when context is insufficient
 * (Requirement 3.7); otherwise the goal always passes `validateGeneratedGoal`.
 */
export async function generateMarketingGoal(
  options: GenerateGoalOptions,
): Promise<GenerateGoalResult> {
  const { identity } = options;
  const warnings: string[] = [];

  const contextSufficiency = assessCompanyContext(identity);
  if (!contextSufficiency.sufficient) {
    return { contextSufficiency, warnings: [contextSufficiency.message] };
  }

  // Requirement 14.1: ground the generation before it begins.
  let contextTag: string | undefined;
  let groundingBlock = "";
  if (!options.skipGrounding) {
    const grounding = await retrieveGrounding({
      query: `marketing goal for ${identity.name} in ${identity.industry ?? "its industry"}: ${identity.businessObjectives?.join(", ") ?? ""}`,
      scope: "company_memory",
    });
    contextTag = grounding.contextTag;
    groundingBlock = grounding.promptBlock;
  }

  // Deterministic baseline — this is what makes Property 8 unconditional.
  const objectives = (identity.businessObjectives ?? []).filter(
    (o) => o.trim().length > 0,
  );
  let primaryObjective =
    objectives[0]?.trim() ||
    `Grow ${identity.name}'s audience and engagement on social media`;
  let targetPlatform = options.targetPlatform ?? pickPlatform(identity);
  let successMetrics: SuccessMetric[] = [{ ...DEFAULT_SUCCESS_METRIC }];

  const llm = options.llm ?? getLLMClient();
  const raw = await llm.complete(
    `Propose one marketing goal for the company below.\n` +
      `Reply with JSON only: { "primaryObjective": string, "targetPlatform": one of ${[
        "instagram", "tiktok", "linkedin", "facebook", "pinterest", "etsy", "x", "threads", "youtube_shorts",
      ].join("|")}, "successMetrics": [{ "name": string, "numericTarget": number, "timePeriod": string, "direction": "increase"|"decrease"|"maintain" }] }\n` +
      `Every success metric needs a numeric target and a time period.\n\n` +
      `Company: ${identity.name}\nIndustry: ${identity.industry ?? "unknown"}\n` +
      `Mission: ${identity.mission}\nObjectives: ${objectives.join("; ") || "none stated"}\n` +
      (groundingBlock ? `\nPrior context:\n${groundingBlock}\n` : ""),
    { temperature: 0.2 },
  );

  const parsed = parseJSONFromLLM<LLMGoalShape>(raw);
  if (parsed) {
    if (
      typeof parsed.primaryObjective === "string" &&
      parsed.primaryObjective.trim()
    ) {
      primaryObjective = parsed.primaryObjective.trim();
    }
    if (!options.targetPlatform && isSupportedPlatform(parsed.targetPlatform)) {
      targetPlatform = parsed.targetPlatform;
    }
    const metrics = coerceMetrics(parsed.successMetrics);
    if (metrics.length > 0) successMetrics = metrics;
  } else if (raw !== null) {
    warnings.push("LLM goal proposal was unparseable; used derived defaults");
  }

  const goal: MarketingGoal = {
    id: randomUUID(),
    primaryObjective,
    targetPlatform,
    successMetrics,
    status: "proposed",
    kbVersion: "",
    createdAt: new Date().toISOString(),
  };

  // Self-check: repair rather than emit an invalid goal.
  const validation = validateGeneratedGoal(goal);
  if (!validation.valid) {
    if (validation.missingFields.includes("primaryObjective")) {
      goal.primaryObjective = `Grow ${identity.name}'s audience and engagement on social media`;
    }
    if (validation.missingFields.includes("successMetrics")) {
      goal.successMetrics = [{ ...DEFAULT_SUCCESS_METRIC }];
    }
    if (validation.missingFields.includes("targetPlatform")) {
      goal.targetPlatform = pickPlatform(identity);
    }
    warnings.push(
      `Repaired generated goal fields: ${validation.missingFields.join(", ")}`,
    );
  }

  return { goal, contextSufficiency, contextTag, warnings };
}

// ---- Accept / modify / replace (Requirements 3.2–3.6) ----

export interface ConfirmGoalResult {
  /** Absent when validation failed. */
  goal?: MarketingGoal;
  validation: GoalValidationResult;
  /** Operator-facing prompt when validation failed. */
  message?: string;
  /**
   * Requirement 3.3: the KB write runs concurrently with audience research.
   * Callers may start the next stage immediately and await this later.
   */
  storage?: Promise<GoalStorageOutcome>;
}

export interface GoalStorageOutcome {
  stored: boolean;
  kbVersion?: string;
  error?: string;
}

export interface ConfirmGoalOptions {
  storagePath?: string;
  /** Skip persistence (tests that only assert validation). */
  skipStorage?: boolean;
}

/**
 * Confirm a goal the operator accepted, modified or replaced.
 *
 * Validation uses the Requirement 3.4–3.6 bar. On success the goal is returned
 * synchronously with an in-flight `storage` promise so audience research can
 * begin without waiting for the KB write (Requirement 3.3).
 */
export function confirmGoal(
  goal: MarketingGoal,
  status: "accepted" | "modified" | "replaced",
  options: ConfirmGoalOptions = {},
): ConfirmGoalResult {
  const validation = validateGoal(goal);
  if (!validation.valid) {
    return {
      validation,
      message:
        "The goal needs a primary objective and at least one quantifiable success metric (numeric target and time period) before it can be stored.",
    };
  }

  const confirmed: MarketingGoal = { ...goal, status };

  if (options.skipStorage) {
    return { goal: confirmed, validation };
  }

  // Deliberately not awaited — see Requirement 3.3.
  const storage = persistGoal(confirmed, options.storagePath).then(
    (outcome) => {
      if (outcome.kbVersion) confirmed.kbVersion = outcome.kbVersion;
      return outcome;
    },
  );

  return { goal: confirmed, validation, storage };
}

/** Write a confirmed goal to the KB. Never rejects; failures are reported. */
export async function persistGoal(
  goal: MarketingGoal,
  storagePath?: string,
): Promise<GoalStorageOutcome> {
  try {
    const result = await writeKBEntity(
      {
        entityId: `goal-${goal.id}`,
        entityType: "company_identity",
        content: renderGoalMarkdown(goal),
        author: "user",
      },
      storagePath,
    );
    return { stored: true, kbVersion: result.version.versionId };
  } catch (err) {
    return {
      stored: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Goals live under the Company_Identity section of the KB Markdown schema, so
 * the four required top-level sections are still emitted.
 */
export function renderGoalMarkdown(goal: MarketingGoal): string {
  const metrics = goal.successMetrics
    .map(
      (m) =>
        `- ${m.name}: ${m.direction} to ${m.numericTarget} over ${m.timePeriod}`,
    )
    .join("\n");
  return [
    "# Company_Identity",
    "",
    "## MarketingGoal",
    `id: ${goal.id}`,
    `primaryObjective: ${goal.primaryObjective}`,
    `targetPlatform: ${goal.targetPlatform}`,
    `status: ${goal.status}`,
    `createdAt: ${goal.createdAt}`,
    "",
    "## SuccessMetrics",
    metrics || "_none_",
    "",
    "# Products",
    "",
    "_empty_",
    "",
    "# Audiences",
    "",
    "_empty_",
    "",
    "# Experiments",
    "",
    "_empty_",
    "",
  ].join("\n");
}
