import type {
  HypothesisCard,
  QueuedWeek,
  QueuedWeekStatus,
  RoadmapSummary,
  WeekPostingPlan,
  WeekQueue,
} from "./types";

const STORAGE_KEY = "liquid-copy.week-posting-plan.v1";
const SEVEN_DAY_KEY = "liquid-copy.seven-day-plan.v1";
const QUEUE_KEY = "liquid-copy.week-queue.v1";

export const MAX_QUEUED_WEEKS = 4;

export interface SevenDayPlanSnapshot {
  roadmap: RoadmapSummary;
  hypotheses: HypothesisCard[];
  updatedAt: string;
}

function startOfDay(d: Date): Date {
  const date = new Date(d);
  date.setHours(10, 0, 0, 0);
  return date;
}

export function weekIdFromStart(weekStartIso: string): string {
  const d = new Date(weekStartIso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `week-${y}-${m}-${day}`;
}

/** KB entity id for a week's own markdown plan doc. */
export function weekPlanEntityIdFromStart(weekStartIso: string): string {
  return `testing-plan-${weekIdFromStart(weekStartIso)}`;
}

/**
 * Advance week start by 7 days until the derived week id is unused.
 * Prevents "Next week" from silently overwriting an existing week.
 */
export function ensureUniqueWeekStart(
  queue: WeekQueue | null,
  start: Date,
): Date {
  const used = new Set((queue?.weeks ?? []).map((w) => w.id));
  const next = startOfDay(start);
  for (let i = 0; i < 12; i++) {
    const id = weekIdFromStart(next.toISOString());
    if (!used.has(id)) return next;
    next.setDate(next.getDate() + 7);
  }
  return next;
}

export function formatWeekLabel(weekStartIso: string, now = new Date()): string {
  const start = startOfDay(new Date(weekStartIso));
  const today = startOfDay(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  if (today.getTime() >= start.getTime() && today.getTime() <= end.getTime()) {
    return "This week";
  }
  return `Week of ${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

export function deriveWeekStatus(
  plan: WeekPostingPlan,
  now = new Date(),
): QueuedWeekStatus {
  const today = startOfDay(now).getTime();
  const starts = plan.slots
    .map((s) => startOfDay(new Date(s.scheduledAt)).getTime())
    .filter((t) => !Number.isNaN(t));
  if (starts.length === 0) {
    const weekStart = startOfDay(new Date(plan.weekStart)).getTime();
    const weekEnd = weekStart + 6 * 24 * 60 * 60 * 1000;
    if (today < weekStart) return "draft";
    if (today > weekEnd) return "done";
    return "active";
  }
  const min = Math.min(...starts);
  const max = Math.max(...starts);
  if (today < min) return "draft";
  if (today > max) return "done";
  return "active";
}

export function buildQueuedWeek(input: {
  plan: WeekPostingPlan;
  hypotheses: HypothesisCard[];
  roadmap?: RoadmapSummary;
  insightsSnippet?: string;
  planEntityId?: string;
}): QueuedWeek {
  const weekStart = input.plan.weekStart;
  const id = weekIdFromStart(weekStart);
  return {
    id,
    weekStart,
    label: formatWeekLabel(weekStart),
    status: deriveWeekStatus(input.plan),
    plan: input.plan,
    roadmap: input.roadmap,
    hypotheses: input.hypotheses,
    insightsSnippet: input.insightsSnippet?.slice(0, 240),
    planEntityId: input.planEntityId ?? `testing-plan-${id}`,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Compact prior-week hooks/titles for the week-planning prompt so the model
 * does not regenerate the same copy on "Next week".
 */
export function formatPriorWeeksForPrompt(
  queue: WeekQueue | null,
  options?: { excludeWeekId?: string; maxLines?: number },
): string {
  if (!queue?.weeks.length) return "";
  const maxLines = options?.maxLines ?? 28;
  const lines: string[] = [];
  for (const week of queue.weeks) {
    if (options?.excludeWeekId && week.id === options.excludeWeekId) continue;
    const label = week.label || week.id;
    const fromHyps = (week.hypotheses ?? []).map((h) => ({
      title: h.title,
      hook: h.hook,
      angle: h.angle,
    }));
    const fromSlots = (week.plan?.slots ?? []).map((s) => ({
      title: s.hypothesisTitle,
      hook: s.hook,
      angle: undefined as string | undefined,
    }));
    const items = fromHyps.length > 0 ? fromHyps : fromSlots;
    for (const item of items) {
      if (lines.length >= maxLines) break;
      const hook = (item.hook || "").trim();
      if (!hook) continue;
      const title = (item.title || "").trim();
      const angle = (item.angle || "").trim();
      lines.push(
        `- [${label}] ${title ? `${title} — ` : ""}${hook}${angle ? ` (${angle})` : ""}`,
      );
    }
    if (lines.length >= maxLines) break;
  }
  return lines.join("\n");
}

/** Next week starts the day after the last slot (or today if empty). */
export function nextWeekStartFromQueue(
  queue: WeekQueue | null,
  now = new Date(),
): Date {
  if (!queue || queue.weeks.length === 0) return startOfDay(now);
  let latest = 0;
  for (const week of queue.weeks) {
    for (const slot of week.plan.slots) {
      const t = new Date(slot.scheduledAt).getTime();
      if (!Number.isNaN(t) && t > latest) latest = t;
    }
    const ws = new Date(week.weekStart).getTime();
    if (!Number.isNaN(ws)) {
      const endGuess = ws + 6 * 24 * 60 * 60 * 1000;
      if (endGuess > latest) latest = endGuess;
    }
  }
  if (!latest) return startOfDay(now);
  const next = startOfDay(new Date(latest));
  next.setDate(next.getDate() + 1);
  const today = startOfDay(now);
  return next.getTime() < today.getTime() ? today : next;
}

export function loadWeekPostingPlan(): WeekPostingPlan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WeekPostingPlan;
    if (!parsed || !Array.isArray(parsed.slots)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveWeekPostingPlan(plan: WeekPostingPlan): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

export function clearWeekPostingPlan(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function loadSevenDayPlanSnapshot(): SevenDayPlanSnapshot | null {
  try {
    const raw = localStorage.getItem(SEVEN_DAY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SevenDayPlanSnapshot;
    if (
      !parsed?.roadmap ||
      !Array.isArray(parsed.hypotheses) ||
      parsed.hypotheses.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSevenDayPlanSnapshot(input: {
  roadmap: RoadmapSummary;
  hypotheses: HypothesisCard[];
}): void {
  const snapshot: SevenDayPlanSnapshot = {
    roadmap: input.roadmap,
    hypotheses: input.hypotheses,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(SEVEN_DAY_KEY, JSON.stringify(snapshot));
}

export function clearSevenDayPlanSnapshot(): void {
  localStorage.removeItem(SEVEN_DAY_KEY);
}

function refreshWeekMeta(week: QueuedWeek): QueuedWeek {
  return {
    ...week,
    label: formatWeekLabel(week.weekStart),
    status: deriveWeekStatus(week.plan),
  };
}

function sortWeeks(weeks: QueuedWeek[]): QueuedWeek[] {
  return [...weeks].sort(
    (a, b) =>
      new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime(),
  );
}

function migrateLegacyPlanIntoQueue(): WeekQueue | null {
  const legacy = loadWeekPostingPlan();
  if (!legacy || !Array.isArray(legacy.slots) || legacy.slots.length === 0) {
    return null;
  }
  const seven = loadSevenDayPlanSnapshot();
  const week = buildQueuedWeek({
    plan: legacy,
    hypotheses: seven?.hypotheses ?? [],
    roadmap: seven?.roadmap,
  });
  const queue: WeekQueue = {
    weeks: [week],
    updatedAt: new Date().toISOString(),
  };
  saveWeekQueue(queue);
  return queue;
}

export function loadWeekQueue(): WeekQueue {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WeekQueue;
      if (parsed && Array.isArray(parsed.weeks)) {
        const weeks = sortWeeks(parsed.weeks.map(refreshWeekMeta));
        return { weeks, updatedAt: parsed.updatedAt || new Date().toISOString() };
      }
    }
  } catch {
    // fall through to migrate
  }
  const migrated = migrateLegacyPlanIntoQueue();
  return migrated ?? { weeks: [], updatedAt: new Date().toISOString() };
}

export function saveWeekQueue(queue: WeekQueue): void {
  const weeks = sortWeeks(queue.weeks.map(refreshWeekMeta)).slice(
    -MAX_QUEUED_WEEKS,
  );
  const next: WeekQueue = {
    weeks,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  // Compat: keep latest week mirrored for older callers.
  const latest = weeks[weeks.length - 1];
  if (latest) {
    saveWeekPostingPlan(latest.plan);
    if (latest.roadmap && latest.hypotheses.length > 0) {
      saveSevenDayPlanSnapshot({
        roadmap: latest.roadmap,
        hypotheses: latest.hypotheses,
      });
    }
  }
}

export function clearWeekQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
}

export function getQueuedWeek(
  queue: WeekQueue,
  weekId?: string | null,
): QueuedWeek | null {
  if (queue.weeks.length === 0) return null;
  if (weekId) {
    const found = queue.weeks.find((w) => w.id === weekId);
    if (found) return found;
  }
  const active = queue.weeks.find((w) => w.status === "active");
  if (active) return active;
  const draft = queue.weeks.find((w) => w.status === "draft");
  if (draft) return draft;
  return queue.weeks[queue.weeks.length - 1] ?? null;
}

/**
 * Append a week, or replace an existing weekId.
 * Drops oldest done weeks when over cap; throws if still full on append.
 */
export function upsertQueuedWeek(
  week: QueuedWeek,
  mode: "append" | "replaceSelected",
  replaceWeekId?: string,
): WeekQueue {
  const queue = loadWeekQueue();
  let weeks = [...queue.weeks];

  if (mode === "replaceSelected" && replaceWeekId) {
    const idx = weeks.findIndex((w) => w.id === replaceWeekId);
    if (idx >= 0) {
      weeks[idx] = { ...week, id: replaceWeekId };
    } else {
      weeks.push(week);
    }
  } else {
    const existing = weeks.findIndex((w) => w.id === week.id);
    if (existing >= 0) {
      weeks[existing] = week;
    } else {
      // Drop oldest done weeks to make room.
      while (
        weeks.length >= MAX_QUEUED_WEEKS &&
        weeks.some((w) => w.status === "done")
      ) {
        const doneIdx = weeks.findIndex((w) => w.status === "done");
        if (doneIdx < 0) break;
        weeks.splice(doneIdx, 1);
      }
      if (weeks.length >= MAX_QUEUED_WEEKS) {
        throw new Error(
          `Week queue is full (${MAX_QUEUED_WEEKS}). Clear a done week before queuing another.`,
        );
      }
      weeks.push(week);
    }
  }

  const next = { weeks: sortWeeks(weeks), updatedAt: new Date().toISOString() };
  saveWeekQueue(next);
  return next;
}

export function removeQueuedWeek(weekId: string): WeekQueue {
  const queue = loadWeekQueue();
  const next = {
    weeks: queue.weeks.filter((w) => w.id !== weekId),
    updatedAt: new Date().toISOString(),
  };
  saveWeekQueue(next);
  return next;
}
