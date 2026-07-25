import type {
  HypothesisCard,
  PostingPlanSlot,
  WeekPostingPlan,
} from "./types";
import type { OpenCarouselItem } from "./open-carousel";

/** Index / latest-pointer KB entity (not the per-week source of truth). */
export const CENTRAL_PLAN_ENTITY_ID = "testing-plan";

/** One markdown document per queued week — never overwrite week N with week N+1. */
export function weekPlanEntityId(weekId: string): string {
  const safe = weekId.trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `testing-plan-${safe || "week"}`;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Render a week plan document (markdown) from structured plan data.
 * Each week should be saved under its own entity id (`testing-plan-{weekId}`).
 */
export function formatCentralPlanMarkdown(input: {
  plan: WeekPostingPlan;
  hypotheses: HypothesisCard[];
  carousels: OpenCarouselItem[];
  weekId?: string;
  weekLabel?: string;
}): string {
  const { plan, hypotheses, carousels } = input;
  const carouselById = new Map(carousels.map((c) => [c.id, c]));
  const hypLines = hypotheses
    .map((h) => {
      const bits = [
        `### ${h.id} — ${h.title ?? h.hook}`,
        `- **Hook:** ${h.hook}`,
        h.angle ? `- **Angle:** ${h.angle}` : null,
        `- **Platform:** ${h.platform}`,
        `- **Status:** ${h.status}`,
      ];
      return bits.filter(Boolean).join("\n");
    })
    .join("\n\n");

  const weekLines = plan.slots
    .map((s) => {
      const c = carouselById.get(s.carouselId);
      return [
        `### ${s.dayLabel} — ${s.hypothesisTitle}`,
        `- **When:** ${formatWhen(s.scheduledAt)}`,
        `- **Platform:** ${s.platform}`,
        `- **Hook:** ${s.hook}`,
        `- **Hypothesis id:** ${s.hypothesisId}`,
        `- **Carousel:** ${c?.name ?? s.carouselId} (\`${s.carouselId}\`)`,
        c?.status ? `- **Carousel status:** ${c.status}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const machine: WeekPostingPlan = plan;
  const title = input.weekLabel
    ? `Testing plan · ${input.weekLabel}`
    : input.weekId
      ? `Testing plan · ${input.weekId}`
      : "Testing plan";

  return `# ${title}

> Per-week plan document${input.weekId ? ` (\`${input.weekId}\`)` : ""}. Do not reuse hooks from other week docs.

- **Week id:** ${input.weekId ?? "—"}
- **Week start:** ${formatWhen(plan.weekStart)}
- **Updated:** ${formatWhen(plan.createdAt)}
- **Slots:** ${plan.slots.length}

## Summary

${plan.summary}

## Hypotheses

${hypLines || "_No hypotheses._"}

## This week

${weekLines || "_No week slots yet. Build the week plan._"}

## Machine

\`\`\`json
${JSON.stringify(machine, null, 2)}
\`\`\`
`;
}

/** Short index pointing at each per-week plan entity. */
export function formatWeekPlanIndexMarkdown(
  weeks: Array<{ id: string; label: string; weekStart: string; planEntityId: string }>,
): string {
  const lines = weeks.map(
    (w) =>
      `- **${w.label}** (\`${w.id}\`) → \`${w.planEntityId}\` · starts ${formatWhen(w.weekStart)}`,
  );
  return `# Testing plan index

> Pointers to per-week plan markdown. Each week has its own document — never merge weeks.

## Weeks

${lines.length ? lines.join("\n") : "_No weeks queued._"}
`;
}

/** Pull the WeekPostingPlan JSON block from the central plan markdown. */
export function parseCentralPlanMarkdown(
  markdown: string,
): WeekPostingPlan | null {
  const fenced = markdown.match(/```json\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) return null;
  try {
    const parsed = JSON.parse(fenced[1]) as WeekPostingPlan;
    if (!parsed || !Array.isArray(parsed.slots)) return null;
    const slots: PostingPlanSlot[] = parsed.slots.filter(
      (s) =>
        s &&
        typeof s.hypothesisId === "string" &&
        typeof s.carouselId === "string",
    );
    return {
      weekStart: String(parsed.weekStart ?? ""),
      summary: String(parsed.summary ?? ""),
      createdAt: String(parsed.createdAt ?? ""),
      slots,
    };
  } catch {
    return null;
  }
}
