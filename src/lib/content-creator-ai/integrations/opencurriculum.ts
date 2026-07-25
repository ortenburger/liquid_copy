/**
 * OpenCurriculumAdapter — multi-week roadmap planning (Task 6.3, Requirement 6.1).
 *
 * Wraps the OpenCurriculum API. On failure it returns a typed error carrying an
 * operator-facing notification and a `retry` closure that accepts adjusted
 * parameters, rather than throwing.
 *
 * When `OPENCURRICULUM_BASE_URL` is unset the adapter plans locally with a
 * deterministic built-in planner and says so in `warnings` — the platform stays
 * usable offline without silently pretending a remote service answered. A
 * configured-but-failing service is a real error, not a fallback.
 */
import { randomUUID } from "node:crypto";
import type {
  AudiencePersona,
  MarketingGoal,
  RoadmapEntry,
  SuccessMetric,
} from "../types/index.js";

export const MIN_DURATION_WEEKS = 2;
export const MAX_DURATION_WEEKS = 12;

export interface OpenCurriculumInput {
  goal: MarketingGoal;
  personas: AudiencePersona[];
  durationWeeks: number;
  /** Prior-cycle lessons to fold into sequencing (Requirement 6.5). */
  lessonsLearned?: string[];
}

export interface OpenCurriculumSuccess {
  status: "success";
  entries: RoadmapEntry[];
  source: "opencurriculum" | "local_planner";
  warnings: string[];
}

export interface OpenCurriculumError {
  status: "error";
  error: string;
  /** Operator-facing message (Task 6.3: "notify user"). */
  notification: string;
  /** Retry with adjusted parameters (Task 6.3). */
  retry: (
    adjustments?: Partial<OpenCurriculumInput>,
  ) => Promise<OpenCurriculumResult>;
  warnings: string[];
}

export type OpenCurriculumResult = OpenCurriculumSuccess | OpenCurriculumError;

export interface OpenCurriculumAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RemoteEntryShape {
  weekNumber?: number;
  week?: number;
  theme?: string;
  businessObjectiveRef?: string;
  objective?: string;
  successMetrics?: SuccessMetric[];
}

export function clampDurationWeeks(weeks: number): number {
  if (!Number.isFinite(weeks)) return MIN_DURATION_WEEKS;
  return Math.min(
    MAX_DURATION_WEEKS,
    Math.max(MIN_DURATION_WEEKS, Math.floor(weeks)),
  );
}

export class OpenCurriculumAdapter {
  private readonly baseUrl?: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenCurriculumAdapterOptions = {}) {
    const base = options.baseUrl ?? process.env.OPENCURRICULUM_BASE_URL;
    this.baseUrl = base ? base.replace(/\/$/, "") : undefined;
    this.apiKey = options.apiKey ?? process.env.OPENCURRICULUM_API_KEY ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async generateRoadmap(
    input: OpenCurriculumInput,
  ): Promise<OpenCurriculumResult> {
    const durationWeeks = clampDurationWeeks(input.durationWeeks);
    const warnings: string[] = [];
    if (durationWeeks !== input.durationWeeks) {
      warnings.push(
        `durationWeeks ${input.durationWeeks} clamped to ${durationWeeks} (allowed ${MIN_DURATION_WEEKS}–${MAX_DURATION_WEEKS})`,
      );
    }

    if (!this.baseUrl) {
      warnings.push(
        "OPENCURRICULUM_BASE_URL is not configured; planned locally with the built-in planner",
      );
      return {
        status: "success",
        entries: planLocally({ ...input, durationWeeks }),
        source: "local_planner",
        warnings,
      };
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

      const res = await this.fetchImpl(`${this.baseUrl}/v1/roadmaps`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          goal: {
            id: input.goal.id,
            objective: input.goal.primaryObjective,
            platform: input.goal.targetPlatform,
            successMetrics: input.goal.successMetrics,
          },
          personas: input.personas.map((p) => ({
            id: p.id,
            icp: p.icpDefinition,
            painPoints: p.painPoints,
          })),
          durationWeeks,
          lessonsLearned: input.lessonsLearned ?? [],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        return this.error(
          `OpenCurriculum responded ${res.status} ${res.statusText}`.trim(),
          input,
          warnings,
        );
      }

      const body = (await res.json()) as { entries?: RemoteEntryShape[] };
      const entries = normaliseRemoteEntries(body.entries, {
        ...input,
        durationWeeks,
      });
      if (entries.length === 0) {
        return this.error(
          "OpenCurriculum returned no roadmap entries",
          input,
          warnings,
        );
      }
      return {
        status: "success",
        entries,
        source: "opencurriculum",
        warnings,
      };
    } catch (err) {
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      return this.error(
        aborted
          ? `OpenCurriculum request timed out after ${this.timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err),
        input,
        warnings,
      );
    }
  }

  private error(
    reason: string,
    input: OpenCurriculumInput,
    warnings: string[],
  ): OpenCurriculumError {
    return {
      status: "error",
      error: reason,
      notification: `Roadmap generation failed: ${reason}. Adjust the duration or personas and retry.`,
      retry: (adjustments) =>
        this.generateRoadmap({ ...input, ...adjustments }),
      warnings,
    };
  }
}

/** Map a remote payload onto RoadmapEntry, filling anything it omitted. */
function normaliseRemoteEntries(
  raw: RemoteEntryShape[] | undefined,
  input: OpenCurriculumInput & { durationWeeks: number },
): RoadmapEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const fallbackObjective = input.goal.primaryObjective;
  const fallbackMetrics = input.goal.successMetrics;

  return raw
    .map((item, i) => {
      const weekNumber = Number(item.weekNumber ?? item.week ?? i + 1);
      const metrics =
        Array.isArray(item.successMetrics) && item.successMetrics.length > 0
          ? item.successMetrics
          : fallbackMetrics;
      const entry: RoadmapEntry = {
        id: randomUUID(),
        weekNumber: Number.isFinite(weekNumber) ? Math.max(1, Math.floor(weekNumber)) : i + 1,
        theme:
          typeof item.theme === "string" && item.theme.trim()
            ? item.theme.trim()
            : `Week ${i + 1} experiment`,
        hypothesisSlot: null,
        businessObjectiveRef:
          item.businessObjectiveRef ?? item.objective ?? fallbackObjective,
        successMetrics: metrics,
        status: "pending",
      };
      return entry;
    })
    .filter((e) => e.weekNumber <= input.durationWeeks);
}

/**
 * Deterministic built-in planner: one themed entry per week, cycling personas
 * so each gets covered, and seeding early weeks with prior lessons.
 */
export function planLocally(
  input: OpenCurriculumInput & { durationWeeks: number },
): RoadmapEntry[] {
  const { goal, personas, durationWeeks } = input;
  const lessons = (input.lessonsLearned ?? []).filter((l) => l.trim());
  const entries: RoadmapEntry[] = [];

  for (let week = 1; week <= durationWeeks; week++) {
    const persona = personas.length > 0 ? personas[(week - 1) % personas.length] : undefined;
    const painPoint = persona?.painPoints?.[0];
    const lesson = lessons[(week - 1) % Math.max(1, lessons.length)];

    const themeParts = [`Week ${week}`];
    if (painPoint) themeParts.push(`address "${painPoint}"`);
    else themeParts.push(goal.primaryObjective);
    if (lessons.length > 0 && lesson) themeParts.push(`applying: ${lesson}`);

    entries.push({
      id: randomUUID(),
      weekNumber: week,
      theme: themeParts.join(" — ").slice(0, 200),
      hypothesisSlot: null,
      businessObjectiveRef: goal.primaryObjective,
      successMetrics: goal.successMetrics,
      status: "pending",
    });
  }

  return entries;
}
