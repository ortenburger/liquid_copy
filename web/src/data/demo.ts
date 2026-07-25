import type { OpenCarouselItem } from "../lib/open-carousel";
import type {
  AnalyticsRow,
  AnalyticsSummary,
  ExperimentCard,
  HypothesisCard,
  KBEntitySummary,
  OrgGoal,
  OrgProfile,
  PlanChangeRecord,
  RAGPassage,
  RoadmapSummary,
} from "../lib/types";

function demoSlide(title: string, subtitle: string, accent = "#0f766e"): string {
  return `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:72px;background:linear-gradient(160deg,#0b1220 0%,#152238 55%,${accent} 140%);font-family:'Geist','Segoe UI',sans-serif;color:#f8fafc;">
  <p style="font-size:28px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.7;margin:0 0 16px;">Queued</p>
  <h1 style="font-size:72px;line-height:1.05;margin:0 0 20px;font-weight:700;">${title}</h1>
  <p style="font-size:36px;line-height:1.35;margin:0;opacity:0.9;">${subtitle}</p>
</div>`;
}

/** Simulation — carousels waiting to publish (Open Carrusel card shape). */
export const DEMO_QUEUED_CAROUSELS: OpenCarouselItem[] = [
  {
    id: "demo-oc-hyp-03",
    name: "Voice objection flip",
    aspectRatio: "9:16",
    slideCount: 3,
    status: "queued",
    hypothesisId: "hyp-03",
    updatedAt: "2026-07-24T14:00:00.000Z",
    caption: "AI won't replace your brand voice.",
    slides: [
      {
        id: "s1",
        order: 0,
        html: demoSlide(
          "AI won't replace your brand voice.",
          "It grounds it in what already works.",
          "#c2410c",
        ),
      },
      {
        id: "s2",
        order: 1,
        html: demoSlide(
          "Keep the tone.",
          "Ship variants without sounding generic.",
          "#c2410c",
        ),
      },
      {
        id: "s3",
        order: 2,
        html: demoSlide(
          "Liquid Copy",
          "Learning loop for creators.",
          "#c2410c",
        ),
      },
    ],
  },
  {
    id: "demo-oc-hyp-02",
    name: "One-metric carousel",
    aspectRatio: "4:5",
    slideCount: 3,
    status: "queued",
    hypothesisId: "hyp-02",
    updatedAt: "2026-07-23T11:30:00.000Z",
    caption: "3 slides. One metric that moved.",
    slides: [
      {
        id: "s1",
        order: 0,
        html: demoSlide(
          "3 slides.",
          "One metric that moved.",
          "#0369a1",
        ),
      },
      {
        id: "s2",
        order: 1,
        html: demoSlide("+24% ER", "Operational-pain hooks win.", "#0369a1"),
      },
      {
        id: "s3",
        order: 2,
        html: demoSlide("Proof first.", "Story second.", "#0369a1"),
      },
    ],
  },
];

export const DEMO_ANALYTICS_ROWS: AnalyticsRow[] = [
  {
    id: "exp-04",
    title: "Dream-outcome teaser",
    hook: "From guesswork to a learning loop.",
    angle: "Dream outcome + system metaphor.",
    platform: "threads",
    status: "won",
    impressions: 18420,
    engagementRate: 0.062,
    ctr: 0.041,
    saves: 312,
    shares: 148,
    comments: 96,
    winner: true,
    note: "Beat lifestyle framing by ~24% engagement.",
  },
  {
    id: "exp-02",
    title: "Carousel proof stack",
    hook: "3 slides. One metric that moved.",
    angle: "Lead with proof, not brand story.",
    platform: "instagram",
    status: "published",
    impressions: 12110,
    engagementRate: 0.048,
    ctr: 0.033,
    saves: 410,
    shares: 88,
    comments: 54,
    note: "Strong saves; weaker share-through.",
  },
  {
    id: "exp-01",
    title: "Founder-led pain hook",
    hook: "Still drowning in content calendars?",
    angle: "Name a concrete weekly friction for Series A growth leads.",
    platform: "linkedin",
    status: "measuring",
    impressions: 9400,
    engagementRate: 0.055,
    ctr: 0.029,
    saves: 120,
    shares: 76,
    comments: 141,
    note: "Observation window still open.",
  },
  {
    id: "exp-06",
    title: "Failed pattern revisit",
    hook: "Generic urgency CTAs underperformed.",
    angle: "Scare-urgency without a concrete pain.",
    platform: "facebook",
    status: "failed",
    impressions: 6200,
    engagementRate: 0.011,
    ctr: 0.008,
    saves: 12,
    shares: 9,
    comments: 4,
    note: "Priority 0.0 after three inconclusive urgency runs.",
  },
];

export const DEMO_ANALYTICS: AnalyticsSummary = {
  rows: DEMO_ANALYTICS_ROWS,
  winnerId: "exp-04",
  inconclusive: false,
  summary:
    "Winner: dream-outcome / learning-loop hooks on Threads. Operational-pain LinkedIn hooks are measuring well. Generic urgency CTAs remain a failed pattern.",
  updatedAt: "2026-07-25T12:00:00.000Z",
};

export const DEMO_KB_ENTITIES: KBEntitySummary[] = [
  {
    entityId: "testing-plan",
    entityType: "company_identity",
    latestVersion: 1,
    updatedAt: "2026-07-25T12:00:00.000Z",
  },
  {
    entityId: "liquid-copy",
    entityType: "company_identity",
    latestVersion: 3,
    updatedAt: "2026-07-21T09:05:00.000Z",
  },
  {
    entityId: "product-liquid-os",
    entityType: "product",
    latestVersion: 2,
    updatedAt: "2026-07-20T11:00:00.000Z",
  },
  {
    entityId: "persona-growth-lead",
    entityType: "audience",
    latestVersion: 2,
    updatedAt: "2026-07-22T10:15:00.000Z",
  },
  {
    entityId: "goal-01",
    entityType: "company_identity",
    latestVersion: 1,
    updatedAt: "2026-07-22T16:40:00.000Z",
  },
  {
    entityId: "experiment-exp-04",
    entityType: "experiment",
    latestVersion: 2,
    updatedAt: "2026-07-20T18:12:00.000Z",
  },
];

export const DEMO_KB_MARKDOWN: Record<string, string> = {
  "testing-plan": `# Testing plan

> Central plan document. Build the week plan from the Plan tab to refresh this file.

## Summary

Demo seed — press **Plan this week** to generate carousels and rewrite this document.

## Hypotheses

### hyp-01 — Operational pain beats lifestyle
- **Hook:** Still drowning in content calendars?
- **Angle:** Name a concrete weekly friction for Series A growth leads.
- **Platform:** linkedin
- **Status:** measuring

### hyp-02 — One-metric carousel
- **Hook:** 3 slides. One metric that moved.
- **Angle:** Lead with proof, not brand story.
- **Platform:** instagram
- **Status:** published

### hyp-03 — Voice objection flip
- **Hook:** AI won't replace your brand voice.
- **Angle:** Reassure creators that Liquid Copy keeps tone grounded.
- **Platform:** tiktok
- **Status:** queued

### hyp-04 — Learning-loop teaser
- **Hook:** From guesswork to a learning loop.
- **Angle:** Dream outcome + system metaphor.
- **Platform:** threads
- **Status:** won

## This week

_No week slots yet. Build the week plan._

## Machine

\`\`\`json
{
  "weekStart": "",
  "summary": "Demo seed — build the week plan to populate slots.",
  "createdAt": "2026-07-25T12:00:00.000Z",
  "slots": []
}
\`\`\`
`,
  "liquid-copy": `# Company_Identity

## Name
Liquid Copy

## Industry
B2B SaaS · content ops

## Mission
Turn social content into a continuous experiment loop grounded in company knowledge.

## Vision
Every growth team ships weekly experiments without losing brand voice.

## BrandVoice
Precise, technical, optimistic. Prefer measurable outcomes over hype adjectives.

## Values
- Hypothesis before output
- Brand consistency under automation
- Learning written back to the KB

## BusinessObjectives
- Raise LinkedIn engagement on operational-pain hooks
- Lock two winning hook families per month

# Products
_empty_

# Audiences
_empty_

# Experiments
_empty_
`,
  "product-liquid-os": `# Company_Identity
_empty_

# Products

## Liquid Copy Content OS
### Id
product-liquid-os
### Features
- Hypothesis-driven roadmaps
- Open Carrusel variant generation
- Zernio analytics feedback
### Benefits
- Faster learning loops
- Brand-grounded automation
### Pricing
Hackathon / early access
### TargetAudience
Series A–B growth leads

# Audiences
_empty_

# Experiments
_empty_
`,
  "persona-growth-lead": `# Company_Identity
_empty_

# Products
_empty_

# Audiences

## growth-lead
### ICPDefinition
Growth leads at Series A–B SaaS shipping weekly content experiments.
### PainPoints
- Content calendars without learning
- Brand drift under AI tools
- Approvals that stall shipping
### JobsToBeDone
- Ship weekly experiments without losing brand consistency
- Prove which hooks earn attention
### Objections
- AI will flatten our voice
### DreamOutcomes
- From guesswork to a learning loop

# Experiments
_empty_
`,
  "goal-01": `# Company_Identity

## MarketingGoal
### Id
goal-01
### PrimaryObjective
Raise LinkedIn engagement rate on operational-pain hooks for Series A–B growth leads.
### TargetPlatform
linkedin
### Status
accepted
### SuccessMetrics
- Engagement rate → 4.5 (increase) over 4 weeks
- Winning hook families → 2 (increase) per month

# Products
_empty_

# Audiences
_empty_

# Experiments
_empty_
`,
  "experiment-exp-04": `# Company_Identity
_empty_

# Products
_empty_

# Audiences
_empty_

# Experiments

## exp-04
### Hypothesis
Dream-outcome teaser outperforms generic urgency on Threads.
### Status
won
### LessonsLearned
Hooks that name a concrete operational pain outperformed lifestyle framing by 24% engagement.
`,
};

export const DEMO_ORG_PROFILE: OrgProfile = {
  name: "Liquid Copy",
  industry: "B2B SaaS · content ops",
  mission:
    "Turn social content into a continuous experiment loop grounded in company knowledge.",
  brandVoice: "Precise, technical, optimistic. Prefer measurable outcomes over hype.",
  values: [
    "Hypothesis before output",
    "Brand consistency under automation",
    "Learning written back to the KB",
  ],
  website: "https://liquidcopy.example",
};

export const DEMO_ORG_GOAL: OrgGoal = {
  id: "goal-01",
  primaryObjective:
    "Raise LinkedIn engagement rate on operational-pain hooks for Series A–B growth leads.",
  targetPlatform: "linkedin",
  status: "accepted",
  successMetrics: [
    {
      name: "Engagement rate",
      numericTarget: 4.5,
      timePeriod: "4 weeks",
      direction: "increase",
    },
    {
      name: "Winning hook families",
      numericTarget: 2,
      timePeriod: "per month",
      direction: "increase",
    },
  ],
};

export const DEMO_ROADMAP: RoadmapSummary = {
  title: "4-week content experimentation",
  summary:
    "Prove which hooks earn attention for growth leads, then lock a weekly learning loop.",
  weeks: [
    {
      week: 1,
      theme: "Pain naming",
      objective: "Test operational-pain hooks vs lifestyle framing on LinkedIn.",
    },
    {
      week: 2,
      theme: "Proof carousels",
      objective: "Ship Instagram carousels with one measurable outcome per deck.",
    },
    {
      week: 3,
      theme: "Objection flips",
      objective: "Short-form TikTok variants that reframe AI voice concerns.",
    },
    {
      week: 4,
      theme: "Double-down",
      objective: "Scale the winning hook family; retire failed urgency CTAs.",
    },
  ],
};

export const DEMO_HYPOTHESES: HypothesisCard[] = [
  {
    id: "hyp-01",
    title: "Operational pain beats lifestyle",
    hook: "Still drowning in content calendars?",
    angle: "Name a concrete weekly friction for Series A growth leads.",
    platform: "linkedin",
    status: "measuring",
  },
  {
    id: "hyp-02",
    title: "One-metric carousel",
    hook: "3 slides. One metric that moved.",
    angle: "Lead with proof, not brand story.",
    platform: "instagram",
    status: "published",
  },
  {
    id: "hyp-03",
    title: "Voice objection flip",
    hook: "AI won't replace your brand voice.",
    angle: "Reassure creators that Liquid Copy keeps tone grounded.",
    platform: "tiktok",
    status: "queued",
  },
  {
    id: "hyp-04",
    title: "Learning-loop teaser",
    hook: "From guesswork to a learning loop.",
    angle: "Dream outcome + system metaphor.",
    platform: "threads",
    status: "won",
  },
];

export const DEMO_PLAN_HISTORY: PlanChangeRecord[] = [
  {
    id: "hist-01",
    stage: "AudienceReview",
    action: "approved",
    summary: "Locked ICP on Series A–B growth leads; dropped SMB generalists.",
    at: "2026-07-22T10:15:00.000Z",
  },
  {
    id: "hist-02",
    stage: "GoalReview",
    action: "edited",
    summary: "Narrowed primary KPI to engagement rate on LinkedIn hooks.",
    at: "2026-07-22T16:40:00.000Z",
  },
  {
    id: "hist-03",
    stage: "ContextReview",
    action: "approved",
    summary: "Accepted company voice: precise, technical, optimistic.",
    at: "2026-07-21T09:05:00.000Z",
  },
  {
    id: "hist-04",
    stage: "HypothesisReview",
    action: "rejected",
    summary: "Regenerate: drop generic urgency CTAs; keep operational pain.",
    at: "2026-07-20T14:22:00.000Z",
  },
];

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
