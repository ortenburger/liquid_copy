import type { WeekPostingPlan } from "./types";

const STORAGE_KEY = "liquid-copy.week-posting-plan.v1";

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
