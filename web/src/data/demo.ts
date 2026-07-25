import type { ExperimentCard, RAGPassage } from "../lib/types";

export const DEMO_EXPERIMENTS: ExperimentCard[] = [
  {
    id: "exp-01",
    title: "Founder-led pain hook",
    hook: "Still drowning in content calendars?",
    platform: "linkedin",
    status: "measuring",
    updatedAt: "2026-07-24T14:20:00.000Z",
  },
  {
    id: "exp-02",
    title: "Carousel proof stack",
    hook: "3 slides. One metric that moved.",
    platform: "instagram",
    status: "published",
    updatedAt: "2026-07-23T09:05:00.000Z",
  },
  {
    id: "exp-03",
    title: "Short-form objection flip",
    hook: "AI won't replace your brand voice.",
    platform: "tiktok",
    status: "queued",
    updatedAt: "2026-07-25T08:40:00.000Z",
  },
  {
    id: "exp-04",
    title: "Dream-outcome teaser",
    hook: "From guesswork to a learning loop.",
    platform: "threads",
    status: "won",
    updatedAt: "2026-07-20T18:12:00.000Z",
  },
  {
    id: "exp-05",
    title: "Pricing clarity angle",
    hook: "What growth teams actually pay for.",
    platform: "x",
    status: "draft",
    updatedAt: "2026-07-25T11:00:00.000Z",
  },
  {
    id: "exp-06",
    title: "Failed pattern revisit",
    hook: "Generic urgency CTAs underperformed.",
    platform: "facebook",
    status: "failed",
    updatedAt: "2026-07-18T12:30:00.000Z",
  },
];

export const DEMO_PASSAGES: RAGPassage[] = [
  {
    content:
      "Brand voice: precise, technical, optimistic. Avoid hype adjectives; prefer measurable outcomes and short clauses.",
    sourceDoc: "company_identity_v3",
    similarityScore: 0.91,
    scope: "company_memory",
  },
  {
    content:
      "Winning pattern: hooks that name a concrete operational pain (calendars, approvals, reporting) outperformed lifestyle framing by 24% engagement.",
    sourceDoc: "experiment_exp-04_v2",
    similarityScore: 0.87,
    scope: "experiment_history",
  },
  {
    content:
      "ICP: growth leads at Series A–B SaaS. Jobs-to-be-done: ship weekly experiments without losing brand consistency.",
    sourceDoc: "audience_growth-lead",
    similarityScore: 0.84,
    scope: "audience_learning",
  },
  {
    content:
      "Product: Liquid Copy Content OS — hypothesis → Open Carrusel variants → Zernio analytics → KB learning.",
    sourceDoc: "product_liquid_os",
    similarityScore: 0.79,
    scope: "product_context",
  },
  {
    content:
      "Failed pattern: all-caps urgency CTAs scored priority 0.0 after three inconclusive runs.",
    sourceDoc: "experiment_exp-06_v1",
    similarityScore: 0.72,
    scope: "experiment_history",
  },
];
