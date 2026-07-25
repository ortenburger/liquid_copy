import { tool } from "ai";
import { z } from "zod";
import type {
  ApprovalCheckpointStage,
  HypothesisCard,
  KBDocumentView,
  KBEntitySummary,
  RAGPassage,
  RoadmapSummary,
  SocialPlatform,
  WorkflowStatus,
} from "../types";
import type { AnalyticsSummary } from "../types";
import type { OpenCarouselItem, QueueOpenCarouselOptions } from "../open-carousel";
import type { SaveToRagInput } from "./types";

export interface LiquidCopyToolDeps {
  listKBEntities: () => Promise<KBEntitySummary[]>;
  getKBEntity: (entityId: string) => Promise<KBDocumentView>;
  search: (
    query: string,
    opts?: { limit?: number },
  ) => Promise<RAGPassage[]>;
  generateTestingPlan: (focus?: string) => Promise<unknown>;
  updateTestingPlan: (input: {
    roadmap?: RoadmapSummary;
    hypotheses?: HypothesisCard[];
    notes?: string;
  }) => Promise<{
    roadmap: RoadmapSummary | null;
    roadmapText: string | null;
    hypotheses: HypothesisCard[];
  }>;
  getTestingPlan: () => Promise<{
    roadmap: RoadmapSummary | null;
    roadmapText: string | null;
    hypotheses: HypothesisCard[];
  }>;
  queueCarouselFromIdea: (
    input: QueueOpenCarouselOptions & { idea: string; slideCount?: number },
  ) => Promise<OpenCarouselItem>;
  getWorkflowStatus: () => Promise<WorkflowStatus>;
  checkpointAction: (
    stage: ApprovalCheckpointStage,
    action: "approve",
  ) => Promise<unknown>;
  getAnalytics: () => Promise<AnalyticsSummary>;
  saveToRag: (input: SaveToRagInput) => Promise<{
    entityId: string;
    entityType: string;
    versionNumber: number;
    append: boolean;
  }>;
  /** Firecrawl scrape → company markdown KB + RAG reindex. */
  ingestWebsite: (url: string) => Promise<{
    ok: boolean;
    url: string;
    status?: string;
    name?: string;
    kbVersion?: string;
    warnings?: string[];
    message: string;
  }>;
}

const entityTypeSchema = z.enum([
  "company_identity",
  "product",
  "audience",
  "experiment",
]);

const platformSchema = z.enum([
  "instagram",
  "tiktok",
  "linkedin",
  "facebook",
  "pinterest",
  "etsy",
  "x",
  "threads",
  "youtube_shorts",
]);

const roadmapWeekSchema = z.object({
  week: z.number().int().min(1).max(12),
  theme: z.string(),
  objective: z.string(),
});

const roadmapSchema = z.object({
  title: z.string(),
  summary: z.string(),
  weeks: z.array(roadmapWeekSchema).min(1),
});

const hypothesisSchema = z.object({
  id: z.string(),
  hook: z.string(),
  angle: z.string().optional(),
  platform: platformSchema,
  status: z.string().optional(),
  title: z.string().optional(),
});

/**
 * Zod-described tools for ToolLoopAgent — the model chooses when to call them.
 * Docs: https://ai-sdk.dev/docs/agents/overview
 */
export function createLiquidCopyTools(deps: LiquidCopyToolDeps) {
  return {
    list_kb: tool({
      description:
        "List knowledge-base entities (markdown docs) with type and version.",
      inputSchema: z.object({}),
      execute: async () => {
        const entities = await deps.listKBEntities();
        return {
          count: entities.length,
          entities: entities.map((e) => ({
            entityId: e.entityId,
            entityType: e.entityType,
            version: e.latestVersion,
          })),
        };
      },
    }),

    read_markdown: tool({
      description: "Read a KB markdown entity by id (e.g. liquid-copy).",
      inputSchema: z.object({
        entityId: z
          .string()
          .describe("KB entity id without .md extension"),
      }),
      execute: async ({ entityId }) => {
        const doc = await deps.getKBEntity(entityId.trim() || "liquid-copy");
        if (!doc.found || !doc.markdown) {
          return { found: false, entityId, markdown: null };
        }
        const markdown =
          doc.markdown.length > 4000
            ? `${doc.markdown.slice(0, 4000)}\n…(truncated)`
            : doc.markdown;
        return { found: true, entityId: doc.entityId, markdown };
      },
    }),

    search_rag: tool({
      description:
        "Semantic search over the RAG vector index (KB passages).",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      execute: async ({ query, limit }) => {
        const passages = await deps.search(query, { limit: limit ?? 5 });
        return {
          count: passages.length,
          passages: passages.map((p) => ({
            scope: p.scope,
            sourceDoc: p.sourceDoc,
            score: p.similarityScore,
            content: p.content,
          })),
        };
      },
    }),

    save_to_rag: tool({
      description:
        "Write markdown into the knowledge base and reindex RAG so it can be retrieved later. Use when the user asks to save, remember, or store knowledge.",
      inputSchema: z.object({
        entityId: z
          .string()
          .describe("Slug id for the doc, e.g. chat-note or product-liquid-os"),
        entityType: entityTypeSchema
          .optional()
          .describe("KB entity type; guessed from id if omitted"),
        markdown: z.string().describe("Markdown content to store"),
        append: z
          .boolean()
          .optional()
          .describe("If true, append to existing entity content"),
      }),
      execute: async ({ entityId, entityType, markdown, append }) => {
        const saved = await deps.saveToRag({
          entityId,
          entityType,
          markdown,
          append,
        });
        return {
          ok: true,
          ...saved,
          message: `Saved ${saved.entityId} v${saved.versionNumber} to KB + RAG`,
        };
      },
    }),

    ingest_website: tool({
      description:
        "Scrape a company website with Firecrawl and ingest the content into the markdown knowledge base + RAG index. Use when the user asks to scrape, crawl, ingest, or load a domain/URL into knowledge. Requires real-data mode and a Firecrawl API key in Settings.",
      inputSchema: z.object({
        url: z
          .string()
          .url()
          .describe(
            "Full website URL to scrape, e.g. https://example.com (include https://)",
          ),
      }),
      execute: async ({ url }) => deps.ingestWebsite(url),
    }),

    generate_testing_plan: tool({
      description:
        "Generate or regenerate the testing plan (roadmap + hypotheses). Use when the user asks to create, kickstart, or regenerate a testing plan.",
      inputSchema: z.object({
        focus: z
          .string()
          .optional()
          .describe(
            "Optional focus theme, e.g. LinkedIn pain hooks or Instagram proof carousels",
          ),
      }),
      execute: async ({ focus }) => {
        await deps.generateTestingPlan(focus);
        const plan = await deps.getTestingPlan();
        return {
          ok: true,
          message: focus?.trim()
            ? `Testing plan generated with focus: ${focus.trim()}`
            : "Testing plan generated. Roadmap/hypotheses ready for review.",
          roadmap: plan.roadmap ?? plan.roadmapText,
          hypotheses: plan.hypotheses,
        };
      },
    }),

    update_testing_plan: tool({
      description:
        "Update the current testing plan. Pass a full or revised roadmap and/or hypotheses array. Use after query_testing_plan when the user wants edits.",
      inputSchema: z.object({
        roadmap: roadmapSchema
          .optional()
          .describe("Replacement roadmap (title, summary, weeks)"),
        hypotheses: z
          .array(hypothesisSchema)
          .optional()
          .describe("Replacement hypothesis list"),
        notes: z
          .string()
          .optional()
          .describe("Optional freeform notes when not sending structured fields"),
      }),
      execute: async ({ roadmap, hypotheses, notes }) => {
        const plan = await deps.updateTestingPlan({
          roadmap: roadmap as RoadmapSummary | undefined,
          hypotheses: hypotheses?.map((h) => ({
            id: h.id,
            hook: h.hook,
            angle: h.angle,
            platform: h.platform as SocialPlatform,
            status: (h.status as HypothesisCard["status"]) ?? "draft_review",
            title: h.title,
          })),
          notes,
        });
        return {
          ok: true,
          message: "Testing plan updated.",
          roadmap: plan.roadmap ?? plan.roadmapText,
          hypotheses: plan.hypotheses,
        };
      },
    }),

    query_testing_plan: tool({
      description:
        "Query/read the current testing plan (roadmap weeks + hypotheses). Use when the user asks what the plan is, to show hypotheses, or before updating.",
      inputSchema: z.object({
        section: z
          .enum(["all", "roadmap", "hypotheses"])
          .optional()
          .describe("Which section to return (default all)"),
      }),
      execute: async ({ section }) => {
        const plan = await deps.getTestingPlan();
        const sel = section ?? "all";
        if (sel === "roadmap") {
          return {
            roadmap: plan.roadmap ?? plan.roadmapText,
            hypothesisCount: plan.hypotheses.length,
          };
        }
        if (sel === "hypotheses") {
          return {
            hypotheses: plan.hypotheses,
            count: plan.hypotheses.length,
          };
        }
        return {
          roadmap: plan.roadmap ?? plan.roadmapText,
          hypotheses: plan.hypotheses,
          hypothesisCount: plan.hypotheses.length,
        };
      },
    }),

    queue_carousel: tool({
      description:
        "Create a high-quality swipeable carousel from an idea/concept in the conversation. ALWAYS draft a full 5-slide outline (hook → problem → insight → proof → CTA) in the slides array, grounded in the idea and any company/KB context. The deck is queued on the Test tab for preview + Zernio publish.",
      inputSchema: z.object({
        idea: z
          .string()
          .describe(
            "Core concept — summarize from recent chat if the user did not paste it verbatim. Be specific.",
          ),
        name: z
          .string()
          .optional()
          .describe("Short deck title ≤ 8 words"),
        audience: z
          .string()
          .optional()
          .describe("Who this is for, e.g. Series A growth leads"),
        platform: z
          .enum(["linkedin", "instagram", "tiktok", "threads"])
          .optional()
          .describe("Target platform; default linkedin"),
        tone: z
          .string()
          .optional()
          .describe("Voice, e.g. direct operator-to-operator"),
        cta: z
          .string()
          .optional()
          .describe("Final-slide call to action"),
        aspectRatio: z
          .enum(["1:1", "4:5", "9:16"])
          .optional()
          .describe("Slide aspect ratio; default 4:5"),
        slideCount: z
          .number()
          .int()
          .min(4)
          .max(8)
          .optional()
          .describe("How many slides to generate if slides omitted (default 5)"),
        slides: z
          .array(
            z.object({
              role: z
                .enum(["hook", "problem", "insight", "proof", "howto", "cta"])
                .optional()
                .describe("Narrative role of this slide"),
              eyebrow: z
                .string()
                .optional()
                .describe("Tiny label above title, e.g. PROBLEM"),
              title: z
                .string()
                .describe("Punchy headline ≤ 10 words, scannable"),
              subtitle: z
                .string()
                .describe("Concrete supporting line ≤ 22 words — not generic filler"),
            }),
          )
          .min(4)
          .max(8)
          .optional()
          .describe(
            "Preferred: full outline you write (4–8 slides). First=hook, last=cta. If omitted, an LLM drafts one from the idea.",
          ),
      }),
      execute: async ({
        idea,
        name,
        audience,
        platform,
        tone,
        cta,
        aspectRatio,
        slideCount,
        slides,
      }) => {
        const item = await deps.queueCarouselFromIdea({
          idea,
          name,
          audience,
          platform,
          tone,
          cta,
          aspectRatio,
          slideCount,
          slides: slides as QueueOpenCarouselOptions["slides"],
        });
        return {
          ok: true,
          message: `Queued “${item.name}” (${item.slideCount} slides). Open Test to preview or publish to Zernio.`,
          carouselId: item.id,
          name: item.name,
          aspectRatio: item.aspectRatio,
          slideCount: item.slideCount,
          caption: item.caption,
          status: item.status,
          outline: (slides ?? []).map((s) => ({
            role: s.role,
            title: s.title,
          })),
        };
      },
    }),

    /** @deprecated Prefer generate_testing_plan */
    kickstart_plan: tool({
      description:
        "Alias for generate_testing_plan — generate or regenerate the testing plan.",
      inputSchema: z.object({
        focus: z.string().optional(),
      }),
      execute: async ({ focus }) => {
        await deps.generateTestingPlan(focus);
        const plan = await deps.getTestingPlan();
        return {
          ok: true,
          message: "Testing plan generated (kickstart_plan alias).",
          roadmap: plan.roadmap ?? plan.roadmapText,
          hypotheses: plan.hypotheses,
        };
      },
    }),

    /** @deprecated Prefer query_testing_plan */
    get_testing_plan: tool({
      description: "Alias for query_testing_plan — fetch roadmap and hypotheses.",
      inputSchema: z.object({}),
      execute: async () => {
        const plan = await deps.getTestingPlan();
        return {
          roadmap: plan.roadmap ?? plan.roadmapText,
          hypotheses: plan.hypotheses,
        };
      },
    }),

    list_pending_approvals: tool({
      description: "List workflow checkpoints waiting for approval.",
      inputSchema: z.object({}),
      execute: async () => {
        const status = await deps.getWorkflowStatus();
        const pending = status.checkpoints.filter((c) => c.status === "waiting");
        return {
          count: pending.length,
          pending: pending.map((c) => ({
            stage: c.stage,
            preview: (c.pendingOutput ?? "").slice(0, 240),
          })),
        };
      },
    }),

    approve_checkpoint: tool({
      description:
        "Approve a waiting checkpoint stage (e.g. RoadmapReview, HypothesisReview).",
      inputSchema: z.object({
        stage: z
          .string()
          .describe(
            "Checkpoint stage name, e.g. RoadmapReview or HypothesisReview",
          ),
      }),
      execute: async ({ stage }) => {
        const name = (stage || "RoadmapReview") as ApprovalCheckpointStage;
        await deps.checkpointAction(name, "approve");
        return { ok: true, stage: name, message: `Approved ${name}` };
      },
    }),

    get_analytics: tool({
      description:
        "Get experiment analytics summary: metrics, winners, engagement.",
      inputSchema: z.object({}),
      execute: async () => deps.getAnalytics(),
    }),
  };
}

export type LiquidCopyTools = ReturnType<typeof createLiquidCopyTools>;
