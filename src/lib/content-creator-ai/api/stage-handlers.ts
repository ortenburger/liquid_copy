/**
 * Real workflow stage handlers — wires agents + Open Carrusel into WorkflowEngine.
 *
 * LLM calls go through getLLMClient() (Ollama primary, Claude fallback when keyed).
 */
import type {
  AudiencePersona,
  CompanyIdentity,
  Experiment,
  Hypothesis,
  MarketingGoal,
  PostVariant,
  ExperimentationRoadmap,
  SocialPlatform,
} from "../types/index.js";
import {
  listKBEntityIds,
  readKBEntity,
  readKBEntityType,
} from "../kb/storage.js";
import { parseFromMarkdown } from "../kb/markdown.js";
import { getLLMClient } from "../integrations/llm.js";
import type { WorkflowEngine, StageContext } from "../orchestration/workflow-engine.js";
import { AudienceAgent } from "../agents/audience-agent/index.js";
import {
  generateMarketingGoal,
  confirmGoal,
} from "../agents/strategy-agent/goals.js";
import {
  generateRoadmap,
  approveRoadmap,
} from "../agents/strategy-agent/roadmap.js";
import {
  generateHypothesis,
  approveHypothesis,
} from "../agents/strategy-agent/hypothesis.js";
import {
  ContentAgent,
  createOpenCarouselHttpClient,
  createOpenCarouselStubClient,
  type OpenCarouselClient,
} from "../agents/content-agent/index.js";
import { PublishingQueue } from "../publishing/queue.js";
import {
  createStubPublishRecord,
  type PlatformAdapter,
} from "../publishing/adapters/types.js";
import { AnalyticsAgent } from "../agents/analytics-agent/index.js";
import { LearningAgent } from "../agents/learning-agent/index.js";
import { ZernioAdapter } from "../integrations/zernio.js";

export interface StageHandlerDeps {
  workflow: WorkflowEngine;
  audienceAgent: AudienceAgent;
}

function asIdentity(raw: unknown): CompanyIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.companySummary && typeof o.companySummary === "object") {
    return o.companySummary as CompanyIdentity;
  }
  if (typeof o.name === "string" && typeof o.mission === "string") {
    return raw as CompanyIdentity;
  }
  return null;
}

function asGoal(raw: unknown): MarketingGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.goal && typeof o.goal === "object") return o.goal as MarketingGoal;
  if (typeof o.primaryObjective === "string") return raw as MarketingGoal;
  return null;
}

function asPersonas(raw: unknown): AudiencePersona[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.personas)) return o.personas as AudiencePersona[];
  if (Array.isArray(raw)) return raw as AudiencePersona[];
  return [];
}

function asRoadmap(raw: unknown): ExperimentationRoadmap | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.roadmap && typeof o.roadmap === "object") {
    return o.roadmap as ExperimentationRoadmap;
  }
  if (Array.isArray(o.entries)) return raw as ExperimentationRoadmap;
  return null;
}

function asHypothesis(raw: unknown): Hypothesis | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.hypothesis && typeof o.hypothesis === "object") {
    return o.hypothesis as Hypothesis;
  }
  if (typeof o.hook === "string" && typeof o.coreCopy === "string") {
    return raw as Hypothesis;
  }
  return null;
}

function asVariants(raw: unknown): PostVariant[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.variants)) return o.variants as PostVariant[];
  return [];
}

/** Load the newest company_identity payload from KB storage. */
export async function loadCompanyIdentityFromKB(): Promise<{
  identity: CompanyIdentity;
  entityId: string;
} | null> {
  const ids = listKBEntityIds();
  for (const id of ids) {
    const type = readKBEntityType(id);
    // Prefer typed company records; also accept slug ids without meta from older writes.
    if (type && type !== "company_identity") continue;
    if (id.startsWith("goal-") || id.startsWith("persona-") || id.startsWith("roadmap-") || id.startsWith("hypothesis-")) {
      continue;
    }
    const markdown = await readKBEntity(id);
    if (!markdown) continue;
    const parsed = parseFromMarkdown(markdown);
    const identity = parsed.payload.companyIdentity;
    if (identity?.name?.trim() && identity.mission?.trim()) {
      return { identity: { ...identity, id: identity.id || id }, entityId: id };
    }
  }
  return null;
}

async function resolveOpenCarouselClient(
  baseUrl: string,
): Promise<{ client: OpenCarouselClient; mode: "http" | "stub"; baseUrl: string }> {
  const root = baseUrl.replace(/\/$/, "") || "http://localhost:3000";
  try {
    const res = await fetch(`${root}/api/carousels`, {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      console.info(`[workflow] Open Carrusel reachable at ${root}`);
      return {
        client: createOpenCarouselHttpClient(root),
        mode: "http",
        baseUrl: root,
      };
    }
  } catch (err) {
    console.warn(
      `[workflow] Open Carrusel not reachable at ${root}: ${
        err instanceof Error ? err.message : String(err)
      } — using in-memory stub`,
    );
  }
  return {
    client: createOpenCarouselStubClient(),
    mode: "stub",
    baseUrl: root,
  };
}

function devPublishAdapter(platform: SocialPlatform): PlatformAdapter {
  return {
    platform,
    async publish(variant) {
      return createStubPublishRecord(variant, {
        status: "published",
        publishedAt: new Date().toISOString(),
      });
    },
  };
}

/**
 * Register handlers for every workflow stage on the live engine.
 */
export function registerWorkflowStageHandlers(deps: StageHandlerDeps): void {
  const { workflow, audienceAgent } = deps;
  const llm = () => getLLMClient();

  workflow.register("ContextIngestion", async () => {
    console.info("[workflow] ContextIngestion — loading company KB");
    const loaded = await loadCompanyIdentityFromKB();
    if (!loaded) {
      throw new Error(
        "No company identity in the knowledge base yet. Ingest a company URL on the Knowledge page, then Run workflow again.",
      );
    }
    console.info(
      `[workflow] ContextIngestion — using ${loaded.identity.name} (${loaded.entityId})`,
    );
    return {
      companySummary: loaded.identity,
      entityId: loaded.entityId,
      source: "kb",
      summary: `Loaded ${loaded.identity.name} from KB`,
    };
  });

  workflow.register("GoalGeneration", async (ctx: StageContext) => {
    console.info("[workflow] GoalGeneration — LLM via Ollama/Claude fallback");
    const identity =
      asIdentity(ctx.outputs.ContextIngestion) ??
      (await loadCompanyIdentityFromKB())?.identity;
    if (!identity) {
      throw new Error("GoalGeneration needs company context from ContextIngestion / KB.");
    }

    const platforms = workflow.getSelectedPlatforms();
    const generated = await generateMarketingGoal({
      identity,
      targetPlatform: platforms[0],
      llm: llm(),
    });
    if (!generated.goal) {
      throw new Error(
        generated.warnings[0] ??
          generated.contextSufficiency.message ??
          "Could not generate a marketing goal",
      );
    }

    const confirmed = confirmGoal(generated.goal, "accepted");
    if (!confirmed.goal) {
      throw new Error(confirmed.message ?? "Goal confirmation failed");
    }
    if (confirmed.storage) void confirmed.storage;

    console.info(
      `[workflow] GoalGeneration — ${confirmed.goal.primaryObjective} @ ${confirmed.goal.targetPlatform}`,
    );
    return {
      goal: confirmed.goal,
      warnings: generated.warnings,
      contextTag: generated.contextTag,
      summary: confirmed.goal.primaryObjective,
    };
  });

  workflow.register("AudienceResearch", async (ctx: StageContext) => {
    console.info("[workflow] AudienceResearch — proposing personas");
    const goal = asGoal(ctx.outputs.GoalGeneration);
    if (!goal) throw new Error("AudienceResearch needs a goal from GoalGeneration.");
    const identity = asIdentity(ctx.outputs.ContextIngestion) ?? undefined;

    const proposed = await audienceAgent.proposePersonas({
      goal,
      identity,
      llm: llm(),
      count: 3,
    });

    const stored: AudiencePersona[] = [];
    for (const persona of proposed.personas) {
      const result = await audienceAgent.acceptPersona(persona);
      if (result.stored && result.persona) stored.push(result.persona);
      else stored.push(persona);
    }

    console.info(
      `[workflow] AudienceResearch — ${stored.length} personas (${proposed.durationMs}ms)`,
    );
    return {
      personas: stored,
      warnings: proposed.warnings,
      contextTag: proposed.contextTag,
      summary: `${stored.length} personas`,
    };
  });

  workflow.register("PlatformSelection", async (ctx: StageContext) => {
    let selected = workflow.getSelectedPlatforms();
    const goal = asGoal(ctx.outputs.GoalGeneration);
    if (selected.length === 0 && goal?.targetPlatform) {
      selected = [goal.targetPlatform];
      workflow.setSelectedPlatforms(selected);
    }
    if (selected.length === 0) {
      selected = ["instagram", "linkedin"];
      workflow.setSelectedPlatforms(selected);
    }
    console.info(`[workflow] PlatformSelection — ${selected.join(", ")}`);
    return {
      platforms: selected,
      summary: selected.join(", "),
    };
  });

  workflow.register("RoadmapGeneration", async (ctx: StageContext) => {
    console.info("[workflow] RoadmapGeneration");
    const goal = asGoal(ctx.outputs.GoalGeneration);
    if (!goal) throw new Error("RoadmapGeneration needs a goal.");
    const personas = asPersonas(ctx.outputs.AudienceResearch);

    const generated = await generateRoadmap({
      goal,
      personas,
      durationWeeks: 4,
    });
    if (!generated.roadmap) {
      throw new Error(
        generated.error?.notification ??
          generated.error?.error ??
          generated.warnings[0] ??
          "Roadmap generation failed",
      );
    }

    const approved = await approveRoadmap(generated.roadmap);
    if (!approved.scheduled && approved.error) {
      // Still return the roadmap so Hypothesis can use entries; note the warning.
      console.warn(`[workflow] Roadmap approve issue: ${approved.error}`);
    }

    console.info(
      `[workflow] RoadmapGeneration — ${approved.roadmap.entries.length} entries`,
    );
    return {
      roadmap: approved.roadmap,
      activeEntry: approved.activeEntry ?? approved.roadmap.entries[0],
      warnings: generated.warnings,
      firstCycle: generated.firstCycle,
      summary: `${approved.roadmap.durationWeeks}w · ${approved.roadmap.entries.length} slots`,
    };
  });

  workflow.register("HypothesisGeneration", async (ctx: StageContext) => {
    console.info("[workflow] HypothesisGeneration — LLM via Ollama/Claude fallback");
    const goal = asGoal(ctx.outputs.GoalGeneration);
    const personas = asPersonas(ctx.outputs.AudienceResearch);
    const roadmap = asRoadmap(ctx.outputs.RoadmapGeneration);
    const entry =
      (ctx.outputs.RoadmapGeneration as { activeEntry?: unknown } | undefined)
        ?.activeEntry ?? roadmap?.entries?.[0];

    if (!goal || !roadmap || !entry || typeof entry !== "object") {
      throw new Error("HypothesisGeneration needs goal, personas, and a roadmap entry.");
    }

    const generated = await generateHypothesis({
      roadmapEntry: entry as ExperimentationRoadmap["entries"][number],
      marketingGoal: goal,
      audiencePersonas: personas,
      firstCycle: true,
      llm: llm(),
    });

    if (generated.status !== "generated") {
      throw new Error(generated.message);
    }

    const approved = await approveHypothesis(generated.hypothesis);
    console.info(`[workflow] HypothesisGeneration — hook: ${approved.hypothesis.hook}`);
    return {
      hypothesis: approved.hypothesis,
      warnings: generated.warnings,
      conflicts: generated.conflicts,
      summary: approved.hypothesis.hook,
    };
  });

  workflow.register("ContentGeneration", async (ctx: StageContext) => {
    const hypothesis = asHypothesis(ctx.outputs.HypothesisGeneration);
    if (!hypothesis) {
      throw new Error("ContentGeneration needs an approved hypothesis.");
    }

    let platforms = workflow.getSelectedPlatforms();
    if (platforms.length === 0) {
      throw new Error(
        "Select at least one publishing platform on the Platforms page before content generation.",
      );
    }
    // Keep generation bounded for local Open Carrusel + LLM latency.
    platforms = platforms.slice(0, 2);

    const baseUrl =
      process.env.OPENCAROUSEL_BASE_URL ?? "http://localhost:3000";
    const { client, mode, baseUrl: resolvedBase } =
      await resolveOpenCarouselClient(baseUrl);

    console.info(
      `[workflow] ContentGeneration — ${platforms.join(", ")} via Open Carrusel (${mode})`,
    );

    const identity =
      asIdentity(ctx.outputs.ContextIngestion) ??
      (await loadCompanyIdentityFromKB())?.identity;
    const websiteUrl =
      process.env.LAST_FIRECRAWL_URL?.trim() ||
      process.env.COMPANY_WEBSITE_URL?.trim() ||
      "";

    const agent = new ContentAgent({
      openCarousel: client,
      variantsPerPlatform: 2,
    });

    const result = await agent.generate(hypothesis, platforms, {
      cta: "Learn more",
      hashtags: ["content", "liquidcopy"],
      slidesPerVariant: 3,
      identity: identity ?? undefined,
      websiteUrl: websiteUrl || undefined,
    });

    if (identity?.name) {
      console.info(
        `[workflow] ContentGeneration — seeded Open Carrusel brand from KB (${identity.name}), no Firecrawl`,
      );
    }

    const carouselIds = [
      ...new Set(result.variants.map((v) => v.carouselId).filter(Boolean)),
    ];
    const primaryCarouselId = carouselIds[0];
    const studioPath = primaryCarouselId
      ? `/app/carousels?view=${encodeURIComponent(primaryCarouselId)}`
      : "/app/carousels";
    const studioUrl = primaryCarouselId
      ? `${resolvedBase}/carousel/${primaryCarouselId}`
      : resolvedBase;

    console.info(
      `[workflow] ContentGeneration — ${result.variants.length} variants, carousels=${carouselIds.join(",") || "none"}`,
    );

    return {
      variants: result.variants,
      discardedCount: result.discardedCount,
      errors: result.errors,
      notification: result.notification,
      carouselIds,
      openCarouselMode: mode,
      studioPath,
      studioUrl,
      summary:
        result.variants.length > 0
          ? `${result.variants.length} variants · open ${studioPath}`
          : result.errors[0] ?? "No variants produced",
    };
  });

  workflow.register("PublishingQueue", async (ctx: StageContext) => {
    const variants = asVariants(ctx.outputs.ContentGeneration);
    if (variants.length === 0) {
      return {
        queued: 0,
        records: [],
        summary: "No variants to publish",
        note: "ContentGeneration produced no publishable variants.",
      };
    }

    console.info(`[workflow] PublishingQueue — enqueue ${variants.length} (dev publish stubs)`);
    const adapters: Partial<Record<SocialPlatform, PlatformAdapter>> = {};
    for (const v of variants) {
      adapters[v.platform] = devPublishAdapter(v.platform);
    }

    const queue = new PublishingQueue({
      adapters,
      sleep: async () => undefined,
      mode: "Full_Auto_Mode",
    });
    queue.enqueue(variants);
    const records = await queue.processAll();

    // Stamp publishedAt onto variant copies for Analytics.
    const publishedVariants = variants.map((v) => {
      const rec = records.find((r) => r.postVariantId === v.id);
      return {
        ...v,
        status: (rec?.status === "published" ? "published" : v.status) as PostVariant["status"],
        publishedAt: rec?.publishedAt ?? v.publishedAt,
      };
    });

    return {
      queued: variants.length,
      records,
      variants: publishedVariants,
      summary: `${records.filter((r) => r.status === "published").length}/${records.length} published (stub adapters)`,
      note: "Real platform credentials are not configured — marked published locally for the learning loop.",
    };
  });

  workflow.register("AnalyticsIngestion", async (ctx: StageContext) => {
    const publishOut = ctx.outputs.PublishingQueue as
      | { variants?: PostVariant[] }
      | undefined;
    const variants =
      publishOut?.variants ?? asVariants(ctx.outputs.ContentGeneration);
    const hypothesis = asHypothesis(ctx.outputs.HypothesisGeneration);

    if (!hypothesis || variants.length === 0) {
      return {
        status: "skipped",
        summary: "No published variants to measure yet",
      };
    }

    const experiment: Experiment = {
      id: `exp-${hypothesis.id}`,
      hypothesisId: hypothesis.id,
      hypothesis,
      postVariantIds: variants.map((v) => v.id),
      publishedDates: variants
        .map((v) => v.publishedAt)
        .filter((d): d is string => typeof d === "string" && d.length > 0),
      status: "running",
      versionCounter: 1,
      createdAt: new Date().toISOString(),
    };

    const agent = new AnalyticsAgent({
      zernio: new ZernioAdapter(),
    });

    // Observation windows usually have not elapsed — evaluate and report honestly.
    const results = await agent.evaluateExperiment(experiment, variants);
    console.info(
      `[workflow] AnalyticsIngestion — ${results.reports.length} reports, conclusive=${results.conclusive}`,
    );

    return {
      experiment,
      results,
      summary: results.conclusive
        ? "Significance ready"
        : `${results.reports.length} report(s) — waiting on observation window / Zernio`,
    };
  });

  workflow.register("LearningUpdate", async (ctx: StageContext) => {
    const analytics = ctx.outputs.AnalyticsIngestion as
      | {
          results?: {
            experiment: Experiment;
            reports: unknown[];
            conclusive: boolean;
            variants: PostVariant[];
            significance?: unknown;
          };
          experiment?: Experiment;
        }
      | undefined;

    if (!analytics?.results?.conclusive) {
      return {
        status: "skipped",
        summary: "Learning skipped — analytics not conclusive yet",
        note: "Re-run after the Zernio observation window elapses.",
      };
    }

    const learning = new LearningAgent();
    try {
      const handled = await learning.handle(analytics.results as never);
      return {
        status: "updated",
        evaluation: handled.evaluation,
        atomic: handled.atomic,
        summary: "KB learning update applied",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[workflow] LearningUpdate soft-fail: ${message}`);
      return {
        status: "skipped",
        summary: message,
      };
    }
  });
}
