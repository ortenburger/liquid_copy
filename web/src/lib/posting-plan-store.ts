import type {
  HypothesisCard,
  RoadmapSummary,
  WeekPostingPlan,
} from "./types";

const STORAGE_KEY = "liquid-copy.week-posting-plan.v1";
const SEVEN_DAY_KEY = "liquid-copy.seven-day-plan.v1";

export interface SevenDayPlanSnapshot {
  roadmap: RoadmapSummary;
  hypotheses: HypothesisCard[];
  updatedAt: string;
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
