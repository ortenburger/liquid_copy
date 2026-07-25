/**
 * Carousel slide outlining for the queue_carousel agent tool.
 * Heuristic fallback + LLM draft grounded in the idea / KB context.
 */

import { completeWithSettings } from "./llm-browser";
import type { LLMSettings } from "./settings";

export type SlideRole =
  | "hook"
  | "problem"
  | "insight"
  | "proof"
  | "howto"
  | "cta";

export interface CarouselSlideBrief {
  title: string;
  subtitle: string;
  role?: SlideRole;
  /** Small label above the title (e.g. 01 / PROBLEM). */
  eyebrow?: string;
}

export interface DraftCarouselInput {
  idea: string;
  name?: string;
  audience?: string;
  platform?: string;
  tone?: string;
  cta?: string;
  slideCount?: number;
  /** Optional RAG / KB snippets to ground copy. */
  context?: string;
}

const ROLE_EYEBROW: Record<SlideRole, string> = {
  hook: "HOOK",
  problem: "PROBLEM",
  insight: "INSIGHT",
  proof: "PROOF",
  howto: "HOW",
  cta: "NEXT",
};

function clampWords(text: string, maxWords: number): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function sentenceish(text: string, maxChars: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Deterministic 5-slide outline when the LLM is unavailable. */
export function briefsFromIdea(
  idea: string,
  name?: string,
  extras?: Pick<DraftCarouselInput, "audience" | "cta" | "platform">,
): CarouselSlideBrief[] {
  const clean = idea.trim().replace(/\s+/g, " ");
  const audience = extras?.audience?.trim() || "your audience";
  const cta =
    extras?.cta?.trim() ||
    (extras?.platform === "linkedin"
      ? "Comment with the bottleneck you want to kill next."
      : "Save this — then ship one variant this week.");
  const hookTitle =
    name?.trim() ||
    clampWords(clean, 8) ||
    "Stop guessing. Start testing.";
  const tension = sentenceish(clean, 110);

  return [
    {
      role: "hook",
      eyebrow: ROLE_EYEBROW.hook,
      title: hookTitle,
      subtitle: tension || "A sharp take your feed will actually stop for.",
    },
    {
      role: "problem",
      eyebrow: ROLE_EYEBROW.problem,
      title: `${audience} is drowning in noise`,
      subtitle:
        "Busy calendars, generic posts, and zero signal on what actually converts.",
    },
    {
      role: "insight",
      eyebrow: ROLE_EYEBROW.insight,
      title: "One friction. One promise.",
      subtitle: sentenceish(
        `Name the pain in their words — then offer a concrete next step. ${clean}`,
        120,
      ),
    },
    {
      role: "proof",
      eyebrow: ROLE_EYEBROW.proof,
      title: "Make it feel true",
      subtitle:
        "Swap vague claims for a concrete moment, number, or before/after they recognize.",
    },
    {
      role: "cta",
      eyebrow: ROLE_EYEBROW.cta,
      title: "Ship the next variant",
      subtitle: cta,
    },
  ];
}

function withEyebrows(slides: CarouselSlideBrief[]): CarouselSlideBrief[] {
  return slides.map((s, i) => {
    const role = s.role ?? guessRole(i, slides.length);
    return {
      ...s,
      role,
      eyebrow: s.eyebrow?.trim() || ROLE_EYEBROW[role] || String(i + 1).padStart(2, "0"),
      title: clampWords(s.title, 12),
      subtitle: sentenceish(s.subtitle, 140),
    };
  });
}

function guessRole(index: number, total: number): SlideRole {
  if (index === 0) return "hook";
  if (index === total - 1) return "cta";
  if (index === 1) return "problem";
  if (index === 2) return "insight";
  if (index === 3) return "proof";
  return "howto";
}

function tryParseSlidesJson(raw: string): CarouselSlideBrief[] | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1]?.trim() ?? trimmed;
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(jsonText.slice(start, end + 1)) as {
      name?: string;
      slides?: Array<{
        title?: string;
        subtitle?: string;
        role?: string;
        eyebrow?: string;
      }>;
    };
    if (!Array.isArray(parsed.slides) || parsed.slides.length < 3) return null;
    return parsed.slides
      .filter((s) => s?.title?.trim() && s?.subtitle?.trim())
      .slice(0, 8)
      .map((s) => ({
        title: s.title!.trim(),
        subtitle: s.subtitle!.trim(),
        role: (s.role as SlideRole | undefined) ?? undefined,
        eyebrow: s.eyebrow?.trim(),
      }));
  } catch {
    return null;
  }
}

/**
 * Ask the configured LLM for a swipeable LinkedIn/IG-style carousel outline.
 * Falls back to briefsFromIdea on any failure.
 */
export async function draftCarouselBriefs(
  llm: LLMSettings,
  input: DraftCarouselInput,
): Promise<{ name: string; slides: CarouselSlideBrief[] }> {
  const idea = input.idea.trim();
  const slideCount = Math.min(8, Math.max(4, input.slideCount ?? 5));
  const fallbackName =
    input.name?.trim() || clampWords(idea, 8) || "Untitled carousel";
  const fallback = {
    name: fallbackName,
    slides: withEyebrows(
      briefsFromIdea(idea, fallbackName, {
        audience: input.audience,
        cta: input.cta,
        platform: input.platform,
      }),
    ),
  };

  if (!idea) return fallback;

  const prompt = `You write high-performing social carousels (LinkedIn / Instagram).

Return ONLY valid JSON (no markdown fences, no commentary):
{
  "name": "short deck title ≤ 8 words",
  "slides": [
    { "role": "hook|problem|insight|proof|howto|cta", "eyebrow": "SHORT LABEL", "title": "≤10 words, punchy", "subtitle": "≤22 words, concrete" }
  ]
}

Rules:
- Exactly ${slideCount} slides
- First slide role=hook, last slide role=cta
- Titles are scannable; no hashtags; no emojis
- Subtitles must sound specific to THIS idea — not generic marketing filler
- Ground claims in the idea and context; invent no fake metrics
- Platform: ${input.platform?.trim() || "linkedin"}
- Audience: ${input.audience?.trim() || "B2B operators / founders"}
- Tone: ${input.tone?.trim() || "direct, sharp, operator-to-operator"}
- Preferred CTA: ${input.cta?.trim() || "(invent a light engagement CTA)"}

IDEA:
${idea}

OPTIONAL CONTEXT (KB / RAG — use if relevant):
${input.context?.trim() || "(none)"}
`;

  try {
    const raw = await completeWithSettings(llm, prompt);
    const slides = tryParseSlidesJson(raw);
    if (!slides || slides.length < 3) return fallback;

    // Prefer model name if present
    let name = fallbackName;
    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(raw.slice(start, end + 1)) as { name?: string };
        if (parsed.name?.trim()) name = clampWords(parsed.name, 10);
      }
    } catch {
      /* keep fallback name */
    }

    return { name: input.name?.trim() || name, slides: withEyebrows(slides) };
  } catch {
    return fallback;
  }
}

export function normalizeSlideBriefs(
  slides: CarouselSlideBrief[] | undefined,
  idea: string,
  name?: string,
): CarouselSlideBrief[] {
  if (slides && slides.length >= 3) {
    return withEyebrows(slides.slice(0, 8));
  }
  return withEyebrows(briefsFromIdea(idea, name));
}
