/**
 * Experimentation roadmap generation (Task 6.4) — Requirements 6.1–6.6.
 *
 * Property 15 invariants, enforced by `normaliseRoadmapEntries` regardless of
 * what OpenCurriculum returned:
 *   (a) span is 2–12 weeks,
 *   (b) every scheduled week holds at least one hypothesis slot,
 *   (c) every entry links a business objective and carries ≥1 success metric.
 *
 * Scheduling is gated on storage: `approveRoadmap` marks the first entry active
 * only after the KB write is confirmed. If storage fails, nothing is scheduled
 * (Requirement 6.4) — the opposite of the Hypothesis rule in 7.5, where approval
 * proceeds despite a failed write.
 */
import { randomUUID } from "node:crypto";
import type {
  AudiencePersona,
  ExperimentationRoadmap,
  MarketingGoal,
  RoadmapEntry,
  SuccessMetric,
} from "../../types/index.js";
import { readKBEntity, writeKBEntity } from "../../kb/storage.js";
import { retrieveGrounding } from "../shared/grounding.js";
import {
  OpenCurriculumAdapter,
  clampDurationWeeks,
  MAX_DURATION_WEEKS,
  MIN_DURATION_WEEKS,
  type OpenCurriculumResult,
} from "../../integrations/opencurriculum.js";
import { DEFAULT_SUCCESS_METRIC } from "./goals.js";

export { MIN_DURATION_WEEKS, MAX_DURATION_WEEKS };

export interface GenerateRoadmapOptions {
  goal: MarketingGoal;
  /** At least one user-approved persona is required (Requirement 6.1). */
  personas: AudiencePersona[];
  durationWeeks: number;
  adapter?: OpenCurriculumAdapter;
  /**
   * Prior-cycle lessons. Omit on the first cycle (Requirement 6.6); when
   * `experimentIds` is supplied instead, lessons are read from the KB (6.5).
   */
  lessonsLearned?: string[];
  /** Experiment entity ids whose Lessons_Learned should be folded in (6.5). */
  priorExperimentIds?: string[];
  storagePath?: string;
  skipGrounding?: boolean;
}

export interface GenerateRoadmapResult {
  roadmap?: ExperimentationRoadmap;
  /** Present when generation failed; carries the adapter's retry closure. */
  error?: Extract<OpenCurriculumResult, { status: "error" }>;
  /** True when no prior lessons were incorporated (Requirement 6.6). */
  firstCycle: boolean;
  lessonsApplied: string[];
  contextTag?: string;
  warnings: string[];
}

/**
 * Ensure Property 15 holds: clamp the span, guarantee one slot per week, and
 * backfill objective/metric links.
 */
export function normaliseRoadmapEntries(
  entries: RoadmapEntry[],
  goal: MarketingGoal,
  durationWeeks: number,
): RoadmapEntry[] {
  const weeks = clampDurationWeeks(durationWeeks);
  const fallbackMetrics: SuccessMetric[] =
    goal.successMetrics.length > 0
      ? goal.successMetrics
      : [{ ...DEFAULT_SUCCESS_METRIC }];
  const objectiveRef =
    goal.primaryObjective.trim() || "Grow audience engagement";

  const byWeek = new Map<number, RoadmapEntry[]>();
  for (const entry of entries) {
    const week = Number.isFinite(entry.weekNumber)
      ? Math.floor(entry.weekNumber)
      : 0;
    if (week < 1 || week > weeks) continue; // drop out-of-span entries
    const repaired: RoadmapEntry = {
      ...entry,
      id: entry.id || randomUUID(),
      weekNumber: week,
      theme: entry.theme?.trim() || `Week ${week} experiment`,
      businessObjectiveRef:
        entry.businessObjectiveRef?.trim() || objectiveRef,
      successMetrics:
        Array.isArray(entry.successMetrics) && entry.successMetrics.length > 0
          ? entry.successMetrics
          : fallbackMetrics,
      hypothesisSlot: entry.hypothesisSlot ?? null,
      status: entry.status ?? "pending",
    };
    const list = byWeek.get(week);
    if (list) list.push(repaired);
    else byWeek.set(week, [repaired]);
  }

  // Every scheduled week needs at least one slot.
  const normalised: RoadmapEntry[] = [];
  for (let week = 1; week <= weeks; week++) {
    const existing = byWeek.get(week);
    if (existing && existing.length > 0) {
      normalised.push(...existing);
      continue;
    }
    normalised.push({
      id: randomUUID(),
      weekNumber: week,
      theme: `Week ${week} experiment`,
      hypothesisSlot: null,
      businessObjectiveRef: objectiveRef,
      successMetrics: fallbackMetrics,
      status: "pending",
    });
  }

  return normalised.sort((a, b) => a.weekNumber - b.weekNumber);
}

/** Structural check mirroring Property 15, usable as a guard by callers. */
export function validateRoadmap(roadmap: ExperimentationRoadmap): {
  valid: boolean;
  problems: string[];
} {
  const problems: string[] = [];
  if (
    roadmap.durationWeeks < MIN_DURATION_WEEKS ||
    roadmap.durationWeeks > MAX_DURATION_WEEKS
  ) {
    problems.push(
      `durationWeeks ${roadmap.durationWeeks} outside ${MIN_DURATION_WEEKS}–${MAX_DURATION_WEEKS}`,
    );
  }
  for (let week = 1; week <= roadmap.durationWeeks; week++) {
    if (!roadmap.entries.some((e) => e.weekNumber === week)) {
      problems.push(`week ${week} has no hypothesis slot`);
    }
  }
  for (const entry of roadmap.entries) {
    if (!entry.businessObjectiveRef?.trim()) {
      problems.push(`entry ${entry.id} has no business objective link`);
    }
    if (!entry.successMetrics || entry.successMetrics.length === 0) {
      problems.push(`entry ${entry.id} has no success metric`);
    }
  }
  return { valid: problems.length === 0, problems };
}

/**
 * Read `Lessons_Learned` for prior experiments out of the KB (Requirement 6.5).
 * Missing or unreadable records are skipped, not fatal.
 */
export async function readLessonsLearned(
  experimentIds: string[],
  storagePath?: string,
): Promise<string[]> {
  const lessons: string[] = [];
  for (const id of experimentIds) {
    try {
      const markdown = await readKBEntity(id, storagePath);
      if (!markdown) continue;
      const match = markdown.match(
        /###\s*LessonsLearned\s*\n([\s\S]*?)(?=\n###\s|\n##\s|\n#\s|$)/i,
      );
      const text = match?.[1]?.trim();
      if (text && text !== "_none_" && text !== "_empty_") lessons.push(text);
    } catch {
      continue;
    }
  }
  return lessons;
}

/**
 * Generate a roadmap. The result is always structurally valid per Property 15;
 * a failed adapter call yields `error` with a retry closure instead.
 */
export async function generateRoadmap(
  options: GenerateRoadmapOptions,
): Promise<GenerateRoadmapResult> {
  const warnings: string[] = [];
  const adapter = options.adapter ?? new OpenCurriculumAdapter();
  const durationWeeks = clampDurationWeeks(options.durationWeeks);
  if (durationWeeks !== options.durationWeeks) {
    warnings.push(
      `durationWeeks ${options.durationWeeks} clamped to ${durationWeeks}`,
    );
  }

  if (options.personas.length === 0) {
    warnings.push(
      "No approved audience persona supplied; roadmap themes fall back to the goal objective",
    );
  }

  // Requirement 6.5 / 6.6: incorporate prior lessons when any exist.
  let lessonsApplied = (options.lessonsLearned ?? []).filter((l) => l.trim());
  if (lessonsApplied.length === 0 && options.priorExperimentIds?.length) {
    lessonsApplied = await readLessonsLearned(
      options.priorExperimentIds,
      options.storagePath,
    );
  }
  const firstCycle = lessonsApplied.length === 0;

  let contextTag: string | undefined;
  if (!options.skipGrounding) {
    const grounding = await retrieveGrounding({
      query: `experimentation roadmap for ${options.goal.primaryObjective}`,
      scope: "experiment_history",
    });
    contextTag = grounding.contextTag;
  }

  const result = await adapter.generateRoadmap({
    goal: options.goal,
    personas: options.personas,
    durationWeeks,
    lessonsLearned: lessonsApplied,
  });

  if (result.status === "error") {
    return { error: result, firstCycle, lessonsApplied, contextTag, warnings: [...warnings, ...result.warnings] };
  }

  const entries = normaliseRoadmapEntries(
    result.entries,
    options.goal,
    durationWeeks,
  );

  const roadmap: ExperimentationRoadmap = {
    id: randomUUID(),
    goalId: options.goal.id,
    durationWeeks,
    entries,
    kbStorageStatus: "pending",
    createdAt: new Date().toISOString(),
  };

  return {
    roadmap,
    firstCycle,
    lessonsApplied,
    contextTag,
    warnings: [...warnings, ...result.warnings],
  };
}

export interface ApproveRoadmapResult {
  roadmap: ExperimentationRoadmap;
  /** True only when storage succeeded AND the first entry was scheduled. */
  scheduled: boolean;
  /** The entry marked active, if any. */
  activeEntry?: RoadmapEntry;
  kbVersion?: string;
  error?: string;
  /** Operator-facing message when storage failed. */
  notification?: string;
}

/**
 * Approve and store a roadmap, then schedule its first hypothesis.
 *
 * Requirement 6.3: at least one slot per scheduled week must exist before
 * approval is allowed. Requirement 6.4: scheduling happens only after storage is
 * confirmed; on failure nothing is marked active and the operator is notified.
 */
export async function approveRoadmap(
  roadmap: ExperimentationRoadmap,
  options: { storagePath?: string } = {},
): Promise<ApproveRoadmapResult> {
  const structural = validateRoadmap(roadmap);
  if (!structural.valid) {
    return {
      roadmap: { ...roadmap, kbStorageStatus: "pending" },
      scheduled: false,
      error: structural.problems.join("; "),
      notification: `The roadmap cannot be approved yet: ${structural.problems.join("; ")}.`,
    };
  }

  try {
    const written = await writeKBEntity(
      {
        entityId: `roadmap-${roadmap.id}`,
        entityType: "experiment",
        content: renderRoadmapMarkdown(roadmap),
        author: "user",
      },
      options.storagePath,
    );

    // Storage confirmed — now, and only now, schedule the first slot.
    const entries = roadmap.entries.map((e, i) =>
      i === 0 ? { ...e, status: "active" as const } : e,
    );
    const stored: ExperimentationRoadmap = {
      ...roadmap,
      entries,
      kbStorageStatus: "confirmed",
    };
    return {
      roadmap: stored,
      scheduled: true,
      activeEntry: entries[0],
      kbVersion: written.version.versionId,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      // Nothing scheduled: entries keep their pending status.
      roadmap: { ...roadmap, kbStorageStatus: "failed" },
      scheduled: false,
      error: reason,
      notification: `The roadmap could not be saved (${reason}). No hypothesis has been scheduled; please retry.`,
    };
  }
}

/** Render a roadmap into the Experiments section of the KB Markdown schema. */
export function renderRoadmapMarkdown(roadmap: ExperimentationRoadmap): string {
  const lines = [
    "# Company_Identity",
    "",
    "_empty_",
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
    `## ${roadmap.id}`,
    "",
    "### Hypothesis",
    "_roadmap_",
    "",
    "### GoalId",
    roadmap.goalId,
    "",
    "### DurationWeeks",
    String(roadmap.durationWeeks),
    "",
    "### Entries",
  ];
  for (const entry of roadmap.entries) {
    lines.push(
      `- week ${entry.weekNumber}: ${entry.theme} [objective: ${entry.businessObjectiveRef}] [metrics: ${entry.successMetrics
        .map((m) => `${m.name}=${m.numericTarget}/${m.timePeriod}`)
        .join(", ")}] [status: ${entry.status}]`,
    );
  }
  lines.push("", "### Status", "draft", "", "### CreatedAt", roadmap.createdAt, "");
  return lines.join("\n");
}
