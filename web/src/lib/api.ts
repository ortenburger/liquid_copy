import { runLiquidCopyAgent } from "./agent/run-agent";
import type {
  AgentChatResult,
  AgentToolEvent,
  ChatMessage,
  KBWriteEntityType,
  RagMarkdownSource,
  SaveToRagInput,
} from "./agent/types";
import { DEMO_QUEUED_CAROUSELS } from "../data/demo";
import { demoStore } from "./demo-store";
import { completeWithSettings } from "./llm-browser";
import { briefsFromIdea, draftCarouselBriefs } from "./carousel-brief";
import {
  findQueuedByHypothesisId,
  listQueuedCarousels,
  patchQueuedCarousel,
  upsertQueuedCarousel,
} from "./carousel-queue-store";
import {
  buildDemoQueuedCarousel,
  queueOpenCarousel,
  type OpenCarouselItem,
  type QueueOpenCarouselOptions,
} from "./open-carousel";
import {
  CENTRAL_PLAN_ENTITY_ID,
  formatCentralPlanMarkdown,
  parseCentralPlanMarkdown,
} from "./central-plan";
import {
  loadSevenDayPlanSnapshot,
  loadWeekPostingPlan,
  saveSevenDayPlanSnapshot,
  saveWeekPostingPlan,
} from "./posting-plan-store";
import {
  getApiBaseUrl,
  isDemoWorkspace,
  loadSettings,
  saveSettings,
} from "./settings";
import { PLAN_CHECKPOINT_STAGES } from "./simple-ui-nav";
import {
  recordSimulatedPublish,
  simulatedPublishesToAnalyticsRows,
  simulatedPublishesToExperimentCards,
} from "./zernio-simulate";
import type {
  AnalyticsRow,
  AnalyticsSummary,
  ApprovalCheckpointStage,
  CheckpointRecord,
  ExperimentCard,
  HypothesisCard,
  InsightPiece,
  KBDocumentView,
  KBEntitySummary,
  OperatingMode,
  OrgGoal,
  OrgProfile,
  PlanChangeRecord,
  PostingPlanSlot,
  RAGPassage,
  RetrievalScope,
  RoadmapSummary,
  SocialPlatform,
  StageRecord,
  WeekPostingPlan,
  WorkflowStage,
  WorkflowStatus,
} from "./types";
import { CHECKPOINT_STAGES, WORKFLOW_STAGES } from "./types";

function startOfWeekMonday(d = new Date()): Date {
  const date = new Date(d);
  date.setHours(10, 0, 0, 0);
  const day = date.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function startOfToday(d = new Date()): Date {
  const date = new Date(d);
  date.setHours(10, 0, 0, 0);
  return date;
}

function aspectForPlatform(
  platform: SocialPlatform,
): "1:1" | "4:5" | "9:16" {
  if (platform === "tiktok" || platform === "youtube_shorts") return "9:16";
  if (platform === "instagram") return "4:5";
  return "4:5";
}

const PLAN_PLATFORMS: SocialPlatform[] = [
  "linkedin",
  "instagram",
  "tiktok",
  "threads",
  "x",
];

function normalizePlanPlatform(raw: unknown): SocialPlatform {
  const p = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (p === "twitter") return "x";
  if ((PLAN_PLATFORMS as string[]).includes(p)) return p as SocialPlatform;
  return "linkedin";
}

function parseHypothesesJson(raw: string): HypothesisCard[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] ?? raw).trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, i): HypothesisCard | null => {
        if (!item || typeof item !== "object") return null;
        const o = item as Record<string, unknown>;
        const hook = String(o.hook ?? "").trim();
        if (!hook) return null;
        const title = String(o.title ?? "").trim() || hook.slice(0, 72);
        const angle = String(o.angle ?? "").trim() || undefined;
        return {
          id: `hyp-7d-${Date.now().toString(36)}-${i}`,
          title,
          hook,
          angle,
          platform: normalizePlanPlatform(o.platform),
          status: "queued",
        };
      })
      .filter((h): h is HypothesisCard => Boolean(h))
      .slice(0, 7);
  } catch {
    return [];
  }
}

function roadmapFromSevenDayHyps(hyps: HypothesisCard[]): RoadmapSummary {
  return {
    title: "Next 7 days",
    summary:
      "RAG-grounded hypotheses for the coming week — one carousel experiment per day.",
    weeks: hyps.map((h, i) => ({
      week: i + 1,
      theme: h.title ?? h.hook.slice(0, 48),
      objective: [h.hook, h.angle].filter(Boolean).join(" — "),
    })),
  };
}

export type {
  AgentChatResult,
  AgentToolEvent,
  ChatMessage,
  ChatRole,
  KBWriteEntityType,
  RagMarkdownSource,
  SaveToRagInput,
} from "./agent/types";

export interface RagAskResult {
  answer: string;
  passages: RAGPassage[];
  markdownSources: RagMarkdownSource[];
  model: string;
  provider: string;
  usedRagContext: boolean;
}

const SCOPE_TO_ENTITY_TYPE: Record<RetrievalScope, KBEntitySummary["entityType"]> =
  {
    company_memory: "company_identity",
    product_context: "product",
    audience_learning: "audience",
    experiment_history: "experiment",
  };

const MAX_MD_CHARS = 10_000;

function guessEntityType(entityId: string): KBWriteEntityType {
  const id = entityId.toLowerCase();
  if (id.startsWith("product") || id.includes("product")) return "product";
  if (
    id.startsWith("persona") ||
    id.startsWith("audience") ||
    id.includes("persona")
  ) {
    return "audience";
  }
  if (id.startsWith("experiment") || id.includes("experiment")) {
    return "experiment";
  }
  return "company_identity";
}

function slugifyEntityId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Parse "save to RAG / remember this" intents from a user message.
 * Formats:
 * - Save to RAG as notes-foo: markdown…
 * - Save to knowledge base (product-liquid-os):\n…
 * - Remember this:\n…
 * - save_to_rag entityId|entityType|markdown
 */
export function parseSaveToRagIntent(message: string): SaveToRagInput | null {
  const text = message.trim();
  if (!text) return null;

  const pipe = text.match(
    /^save_to_rag\s+([^|\n]+)\|([^|\n]+)\|([\s\S]+)$/i,
  );
  if (pipe) {
    const entityId = slugifyEntityId(pipe[1]);
    const typeRaw = pipe[2].trim().toLowerCase();
    const entityType: KBWriteEntityType =
      typeRaw === "product" ||
      typeRaw === "audience" ||
      typeRaw === "experiment" ||
      typeRaw === "company_identity"
        ? typeRaw
        : guessEntityType(entityId);
    return {
      entityId: entityId || "chat-note",
      entityType,
      markdown: pipe[3].trim(),
      append: false,
    };
  }

  const saveAs = text.match(
    /\b(?:save|store|write)\s+(?:this\s+)?(?:to\s+)?(?:the\s+)?(?:rag|kb|knowledge(?:\s*base)?)\s+(?:as|under|to)\s+[`"]?([a-z0-9._-]+)[`"]?\s*:?\s*([\s\S]+)/i,
  );
  if (saveAs?.[2]?.trim()) {
    const entityId = slugifyEntityId(saveAs[1]) || "chat-note";
    return {
      entityId,
      entityType: guessEntityType(entityId),
      markdown: saveAs[2].trim(),
      append: /\bappend\b/i.test(text),
    };
  }

  const saveParen = text.match(
    /\b(?:save|store|write)\s+(?:this\s+)?(?:to\s+)?(?:the\s+)?(?:rag|kb|knowledge(?:\s*base)?)\s*\(\s*([a-z0-9._-]+)\s*\)\s*:?\s*([\s\S]+)/i,
  );
  if (saveParen?.[2]?.trim()) {
    const entityId = slugifyEntityId(saveParen[1]) || "chat-note";
    return {
      entityId,
      entityType: guessEntityType(entityId),
      markdown: saveParen[2].trim(),
      append: /\bappend\b/i.test(text),
    };
  }

  const saveColon = text.match(
    /\b(?:save|store|write)\s+(?:this\s+)?(?:to\s+)?(?:the\s+)?(?:rag|kb|knowledge(?:\s*base)?)\s*:?\s*([\s\S]+)/i,
  );
  if (saveColon?.[1]?.trim()) {
    return {
      entityId: "chat-note",
      entityType: "company_identity",
      markdown: saveColon[1].trim(),
      append: /\bappend\b/i.test(text),
    };
  }

  const remember = text.match(
    /\bremember\s+(?:this|that)\s*(?:for\s+(?:the\s+)?(?:rag|kb|knowledge))?\s*:?\s*([\s\S]+)/i,
  );
  if (remember?.[1]?.trim()) {
    return {
      entityId: "chat-note",
      entityType: "company_identity",
      markdown: remember[1].trim(),
      append: true,
    };
  }

  return null;
}

function guessEntityIdsFromPassage(sourceDoc: string): string[] {
  const ids = new Set<string>();
  const raw = sourceDoc.trim();
  if (!raw) return [];
  ids.add(raw);
  ids.add(raw.replace(/_v\d+$/i, ""));
  ids.add(raw.replace(/^company_identity_?/i, "").replace(/_v\d+$/i, ""));
  // e.g. experiment_exp-04_v2 → experiment-exp-04, exp-04
  const noVer = raw.replace(/_v\d+$/i, "");
  if (noVer.startsWith("experiment_")) {
    ids.add(noVer.replace(/^experiment_/, "experiment-"));
    ids.add(noVer.replace(/^experiment_/, ""));
  }
  if (noVer.startsWith("persona-") || noVer.startsWith("audience_")) {
    ids.add(noVer.replace(/^audience_/, "persona-"));
  }
  if (noVer.startsWith("product_")) {
    ids.add(noVer.replace(/^product_/, "product-"));
  }
  return [...ids].filter(Boolean);
}

export interface OrganizationContext {
  profile: OrgProfile | null;
  goal: OrgGoal | null;
}

function tryParseJson<T>(text: string | undefined): T | null {
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function resolveLiveBase(): string | undefined {
  if (isDemoWorkspace()) return undefined;
  return getApiBaseUrl();
}

function emptyWorkflowStatus(): WorkflowStatus {
  return {
    mode: "Human_In_The_Loop_Mode",
    currentStage: "ContextIngestion",
    stages: WORKFLOW_STAGES.map((stage) => ({
      stage,
      status: "pending" as const,
      approvedByUser: false,
    })),
    checkpoints: CHECKPOINT_STAGES.map((stage) => ({
      stage,
      enabled: true,
      status: "idle" as const,
    })),
    platforms: [],
  };
}

/** Stable placeholder for useSyncExternalStore — never allocate per snapshot. */
const EMPTY_LIVE_STATUS: WorkflowStatus = emptyWorkflowStatus();

function authHeaders(): HeadersInit {
  const s = loadSettings();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (s.firecrawlApiKey.trim()) {
    headers["X-Firecrawl-Api-Key"] = s.firecrawlApiKey.trim();
  }
  if (s.zernioApiKey.trim()) {
    headers["X-Zernio-Api-Key"] = s.zernioApiKey.trim();
  }
  if (s.zernioApiBaseUrl.trim()) {
    headers["X-Zernio-Api-Base"] = s.zernioApiBaseUrl.trim();
  }
  if (s.zernioAccountId.trim()) {
    headers["X-Zernio-Account-Id"] = s.zernioAccountId.trim();
  }
  if (s.zernioPlatform.trim()) {
    headers["X-Zernio-Platform"] = s.zernioPlatform.trim();
  }
  if (s.llm.baseUrl.trim()) headers["X-LLM-Base-Url"] = s.llm.baseUrl.trim();
  if (s.llm.model.trim()) headers["X-LLM-Model"] = s.llm.model.trim();
  if (s.llm.apiKey.trim()) headers["X-LLM-Api-Key"] = s.llm.apiKey.trim();
  if (s.llm.provider) headers["X-LLM-Provider"] = s.llm.provider;
  if (s.llm.fallbackApiKey.trim()) {
    headers["X-LLM-Fallback-Api-Key"] = s.llm.fallbackApiKey.trim();
  }
  if (s.llm.fallbackModel.trim()) {
    headers["X-LLM-Fallback-Model"] = s.llm.fallbackModel.trim();
  }
  if (s.openCarouselBaseUrl.trim()) {
    headers["X-Open-Carousel-Base-Url"] = s.openCarouselBaseUrl.trim();
  }
  if (
    s.lastFirecrawlUrl.trim() &&
    s.lastFirecrawlUrl.trim() !== "https://" &&
    s.lastFirecrawlUrl.trim() !== "http://"
  ) {
    headers["X-Last-Firecrawl-Url"] = s.lastFirecrawlUrl.trim();
  }
  return headers;
}

async function liveFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = resolveLiveBase();
  if (!baseUrl) {
    throw new Error(
      "Real data mode is on, but no API base URL is set. Add one in Settings.",
    );
  }
  const headers = new Headers(authHeaders());
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      throw new Error(
        `Cannot reach Liquid Copy API at ${baseUrl}. Run npm run api:dev (or npm run dev:stack) and confirm Settings → API base URL.`,
      );
    }
    throw e;
  }
  if (!res.ok) {
    const body = await res.text();
    let message = body || res.statusText;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* keep raw */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

function useLive(): boolean {
  return Boolean(resolveLiveBase());
}

/** Normalize backend workflow payload → UI WorkflowStatus. */
function mapWorkflowStatus(raw: Record<string, unknown>): WorkflowStatus {
  const stagesRaw = Array.isArray(raw.stages) ? raw.stages : [];
  const checkpointsRaw = Array.isArray(raw.checkpoints) ? raw.checkpoints : [];
  const platformsRaw = Array.isArray(raw.selectedPlatforms)
    ? raw.selectedPlatforms
    : Array.isArray(raw.platforms)
      ? raw.platforms
      : [];

  const stages: StageRecord[] = WORKFLOW_STAGES.map((stage) => {
    const found = stagesRaw.find(
      (s) =>
        s &&
        typeof s === "object" &&
        (s as { stage?: string }).stage === stage,
    ) as
      | (Partial<StageRecord> & {
          output?: unknown;
          error?: string;
        })
      | undefined;
    const output =
      found?.output && typeof found.output === "object"
        ? (found.output as Record<string, unknown>)
        : undefined;
    return {
      stage,
      status: (found?.status as StageRecord["status"]) ?? "pending",
      approvedByUser: Boolean(found?.approvedByUser),
      summary:
        typeof output?.summary === "string"
          ? output.summary
          : found?.error
            ? String(found.error)
            : undefined,
      studioPath:
        typeof output?.studioPath === "string" ? output.studioPath : undefined,
      error: found?.error ? String(found.error) : undefined,
      output,
    };
  });

  const checkpoints: CheckpointRecord[] = checkpointsRaw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      stage: c.stage as ApprovalCheckpointStage,
      enabled: Boolean(c.enabled),
      status: (c.status as CheckpointRecord["status"]) ?? "idle",
      pendingOutput:
        c.pendingOutput === undefined || c.pendingOutput === null
          ? undefined
          : typeof c.pendingOutput === "string"
            ? c.pendingOutput
            : JSON.stringify(c.pendingOutput, null, 2),
    }));

  const current =
    (typeof raw.currentStage === "string" && raw.currentStage
      ? (raw.currentStage as WorkflowStage)
      : null) ??
    stages.find(
      (s) => s.status === "in_progress" || s.status === "awaiting_approval",
    )?.stage ??
    stages.find((s) => s.status === "pending")?.stage ??
    WORKFLOW_STAGES[WORKFLOW_STAGES.length - 1];

  return {
    mode: (raw.mode as OperatingMode) ?? "Human_In_The_Loop_Mode",
    currentStage: current,
    stages,
    checkpoints,
    platforms: platformsRaw.filter(
      (p): p is SocialPlatform => typeof p === "string",
    ),
  };
}

function mapPassages(raw: unknown): RAGPassage[] {
  const body = raw as { results?: unknown[] } | unknown[];
  const list = Array.isArray(body)
    ? body
    : Array.isArray(body.results)
      ? body.results
      : [];
  return list
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      content: String(p.content ?? p.text ?? ""),
      sourceDoc: String(p.sourceDoc ?? p.id ?? p.entityId ?? "kb"),
      similarityScore: Number(p.similarityScore ?? p.score ?? 0),
      scope: String(p.scope ?? "company_memory"),
    }));
}

function tryParseRoadmap(raw: string): RoadmapSummary | null {
  try {
    const parsed = JSON.parse(raw) as RoadmapSummary;
    if (parsed && Array.isArray(parsed.weeks)) return parsed;
  } catch {
    /* not JSON / not UI shape */
  }
  return null;
}

/** Map engine ExperimentationRoadmap → Simple UI RoadmapSummary. */
function roadmapFromEngine(raw: unknown): RoadmapSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    title?: string;
    durationWeeks?: number;
    entries?: Array<{
      weekNumber?: number;
      theme?: string;
      businessObjectiveRef?: string;
    }>;
  };
  if (Array.isArray(r.entries) && r.entries.length > 0) {
    return {
      title: r.title?.trim() || "Experiment roadmap",
      summary: `${r.durationWeeks ?? r.entries.length} week plan · ${r.entries.length} slots`,
      weeks: r.entries.map((e, i) => ({
        week: e.weekNumber ?? i + 1,
        theme: e.theme?.trim() || `Week ${e.weekNumber ?? i + 1}`,
        objective: e.businessObjectiveRef?.trim() || e.theme?.trim() || "",
      })),
    };
  }
  return null;
}

function hypothesisFromEngine(
  output: Record<string, unknown> | undefined,
  platform: SocialPlatform,
): HypothesisCard | null {
  if (!output) return null;
  const hyp = (output.hypothesis ?? output) as {
    id?: string;
    hook?: string;
    angle?: string;
    theme?: string;
  };
  if (typeof hyp.hook !== "string" || !hyp.hook.trim()) return null;
  return {
    id: hyp.id?.trim() || "hyp-live",
    hook: hyp.hook.trim(),
    angle: hyp.angle?.trim() || hyp.theme?.trim(),
    platform,
    status: "draft_review",
    title: hyp.theme?.trim(),
  };
}

const statusListeners = new Set<() => void>();
let liveStatusCache: WorkflowStatus | null = null;
let liveStatusError: string | null = null;

export function subscribeLiveStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function notifyLiveStatus(): void {
  for (const l of statusListeners) l();
}

async function refreshLiveStatus(): Promise<WorkflowStatus> {
  const raw = await liveFetch<Record<string, unknown>>(
    "/api/content-creator-ai/workflow/status",
  );
  liveStatusCache = mapWorkflowStatus(raw);
  liveStatusError = null;
  notifyLiveStatus();
  return liveStatusCache;
}

export function getLiveStatusSnapshot(): WorkflowStatus | null {
  return liveStatusCache;
}

/** Empty pending pipeline — used instead of demo fixtures in real mode. */
export function getEmptyLiveStatus(): WorkflowStatus {
  return EMPTY_LIVE_STATUS;
}

export function getLiveStatusError(): string | null {
  return liveStatusError;
}

export function clearLiveStatus(): void {
  liveStatusCache = null;
  liveStatusError = null;
  notifyLiveStatus();
}

export const api = {
  isSimulation(): boolean {
    return isDemoWorkspace();
  },

  async syncConfig(): Promise<void> {
    if (!useLive()) return;
    const s = loadSettings();
    await liveFetch("/api/content-creator-ai/config", {
      method: "POST",
      body: JSON.stringify({
        firecrawlApiKey: s.firecrawlApiKey || undefined,
        zernioApiKey: s.zernioApiKey || undefined,
        zernioApiBaseUrl: s.zernioApiBaseUrl || undefined,
        zernioAccountId: s.zernioAccountId || undefined,
        zernioPlatform: s.zernioPlatform || undefined,
        openCarouselBaseUrl: s.openCarouselBaseUrl || undefined,
        lastFirecrawlUrl: s.lastFirecrawlUrl || undefined,
        llm: s.llm,
      }),
    });
  },

  async health(): Promise<{ ok: boolean; service?: string }> {
    if (!useLive()) return { ok: true, service: "demo" };
    return liveFetch("/api/content-creator-ai/health");
  },

  async getWorkflowStatus(): Promise<WorkflowStatus> {
    if (useLive()) {
      try {
        return await refreshLiveStatus();
      } catch (e) {
        liveStatusError = e instanceof Error ? e.message : String(e);
        notifyLiveStatus();
        throw e;
      }
    }
    return demoStore.status();
  },

  async runWorkflow(): Promise<WorkflowStatus> {
    if (useLive()) {
      const result = await liveFetch<{
        status: Record<string, unknown>;
        message?: string;
        contentGeneration?: { studioPath?: string };
      }>("/api/content-creator-ai/workflow/run", {
        method: "POST",
        body: "{}",
      });
      liveStatusCache = mapWorkflowStatus(
        (result.status ?? result) as Record<string, unknown>,
      );
      liveStatusError = null;
      notifyLiveStatus();
      const studio =
        result.contentGeneration?.studioPath ??
        liveStatusCache.stages.find((s) => s.stage === "ContentGeneration")
          ?.studioPath;
      if (studio && typeof window !== "undefined") {
        // Soft navigate hint — Overview also shows a link.
        sessionStorage.setItem("liquid-copy.last-studio-path", studio);
      }
      return liveStatusCache;
    }
    return demoStore.status();
  },

  async resetWorkflow(): Promise<WorkflowStatus> {
    if (useLive()) {
      const result = await liveFetch<{ status: Record<string, unknown> }>(
        "/api/content-creator-ai/workflow/reset",
        { method: "POST", body: "{}" },
      );
      liveStatusCache = mapWorkflowStatus(
        (result.status ?? result) as Record<string, unknown>,
      );
      liveStatusError = null;
      notifyLiveStatus();
      return liveStatusCache;
    }
    return demoStore.status();
  },

  async setMode(mode: OperatingMode): Promise<WorkflowStatus> {
    if (useLive()) {
      const result = await liveFetch<{ status: Record<string, unknown> }>(
        "/api/content-creator-ai/workflow/status",
        { method: "PUT", body: JSON.stringify({ mode }) },
      );
      liveStatusCache = mapWorkflowStatus(
        (result.status ?? result) as Record<string, unknown>,
      );
      liveStatusError = null;
      notifyLiveStatus();
      return liveStatusCache;
    }
    return demoStore.setMode(mode);
  },

  async setPlatforms(platforms: SocialPlatform[]): Promise<SocialPlatform[]> {
    if (useLive()) {
      const result = await liveFetch<{ selected?: SocialPlatform[] }>(
        "/api/content-creator-ai/platform-selection",
        { method: "POST", body: JSON.stringify({ platforms }) },
      );
      await refreshLiveStatus();
      return result.selected ?? platforms;
    }
    return demoStore.setPlatforms(platforms);
  },

  async checkpointAction(
    stage: ApprovalCheckpointStage,
    action: "approve" | "reject" | "edit" | "enable" | "disable",
    payload?: { instructions?: string; notes?: string },
  ) {
    if (useLive()) {
      const body: Record<string, unknown> = {};
      if (payload?.instructions) body.instructions = payload.instructions;
      if (payload?.notes) body.editedOutput = payload.notes;
      await liveFetch(
        `/api/content-creator-ai/checkpoints/${stage}/${action}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      return refreshLiveStatus();
    }
    if (action === "enable") return demoStore.setCheckpointEnabled(stage, true);
    if (action === "disable") return demoStore.setCheckpointEnabled(stage, false);
    if (action === "approve") return demoStore.approve(stage);
    if (action === "reject")
      return demoStore.reject(stage, payload?.instructions ?? "");
    return demoStore.edit(stage, payload?.notes ?? "");
  },

  async search(
    query: string,
    options?: { scope?: RetrievalScope; limit?: number },
  ): Promise<RAGPassage[]> {
    const limit = options?.limit ?? 10;
    if (useLive()) {
      // Push LLM/Ollama base URL so server-side embeddings hit Ollama too.
      await this.syncConfig().catch(() => undefined);
      const raw = await liveFetch<unknown>("/api/content-creator-ai/search", {
        method: "POST",
        body: JSON.stringify({
          query,
          limit,
          ...(options?.scope ? { scope: options.scope } : {}),
        }),
      });
      return mapPassages(raw);
    }
    await new Promise((r) => setTimeout(r, 200));
    return demoStore.searchScoped(query, options?.scope, limit);
  },

  async gatherRagMarkdownContext(
    query: string,
    options?: { scope?: RetrievalScope; limit?: number },
  ): Promise<{
    passages: RAGPassage[];
    markdownSources: RagMarkdownSource[];
  }> {
    const passages = await this.search(query, {
      scope: options?.scope,
      limit: options?.limit ?? 6,
    });

    const entities = await this.listKBEntities().catch(() => []);
    const candidateIds = new Set<string>();

    for (const p of passages) {
      for (const id of guessEntityIdsFromPassage(p.sourceDoc)) {
        candidateIds.add(id);
      }
    }

    for (const entity of entities) {
      const hitBySource = passages.some(
        (p) =>
          p.sourceDoc.includes(entity.entityId) ||
          entity.entityId.includes(p.sourceDoc.replace(/_v\d+$/i, "")),
      );
      if (hitBySource) candidateIds.add(entity.entityId);
    }

    for (const entity of entities) {
      if (candidateIds.size >= 4) break;
      if (
        options?.scope &&
        entity.entityType !== SCOPE_TO_ENTITY_TYPE[options.scope]
      ) {
        continue;
      }
      candidateIds.add(entity.entityId);
    }

    for (const entity of entities) {
      if (entity.entityType === "company_identity") {
        candidateIds.add(entity.entityId);
        break;
      }
    }

    const markdownSources: RagMarkdownSource[] = [];
    let mdBudget = MAX_MD_CHARS;
    for (const entityId of candidateIds) {
      if (mdBudget <= 0 || markdownSources.length >= 5) break;
      const known = entities.find((e) => e.entityId === entityId);
      if (
        entities.length > 0 &&
        !known &&
        !passages.some((p) => p.sourceDoc.includes(entityId))
      ) {
        continue;
      }
      try {
        const doc = await this.getKBEntity(entityId);
        if (!doc.found || !doc.markdown?.trim()) continue;
        const clipped =
          doc.markdown.length > mdBudget
            ? `${doc.markdown.slice(0, mdBudget)}\n…(truncated)`
            : doc.markdown;
        mdBudget -= clipped.length;
        markdownSources.push({
          entityId: doc.entityId,
          entityType: known?.entityType ?? doc.entityType,
          markdown: clipped,
        });
      } catch {
        /* skip missing entity */
      }
    }

    return { passages, markdownSources };
  },

  /**
   * RAG → Ollama (or configured LLM): retrieve passages, load related KB
   * markdown files, then answer with both as context.
   */
  async ragAsk(
    query: string,
    options?: { scope?: RetrievalScope; limit?: number },
  ): Promise<RagAskResult> {
    const llm = loadSettings().llm;
    const { passages, markdownSources } = await this.gatherRagMarkdownContext(
      query,
      options,
    );

    const passageBlock =
      passages.length === 0
        ? "(No RAG passages retrieved.)"
        : passages
            .map(
              (p, i) =>
                `[${i + 1}] scope=${p.scope} source=${p.sourceDoc} score=${p.similarityScore.toFixed(2)}\n${p.content}`,
            )
            .join("\n\n");

    const markdownBlock =
      markdownSources.length === 0
        ? "(No KB markdown files loaded.)"
        : markdownSources
            .map(
              (m) =>
                `--- FILE: ${m.entityId}.md (${m.entityType ?? "unknown"}) ---\n${m.markdown}`,
            )
            .join("\n\n");

    const prompt = `You are Liquid Copy's knowledge assistant. Answer using ONLY the context below (RAG passages + KB markdown files). Prefer the markdown files for structure and the passages for relevance. If context is insufficient, say what is missing. Be concise (max 200 words). No hype.

Question: ${query.trim()}

RAG passages:
${passageBlock}

KB markdown files:
${markdownBlock}

Answer:`;

    const answer = await completeWithSettings(llm, prompt);
    return {
      answer: answer.trim(),
      passages,
      markdownSources,
      model: llm.model,
      provider: llm.provider,
      usedRagContext: passages.length > 0 || markdownSources.length > 0,
    };
  },

  async runAgentTool(
    name: string,
    input?: string,
  ): Promise<AgentToolEvent> {
    const arg = (input ?? "").trim();
    switch (name) {
      case "list_kb": {
        const entities = await this.listKBEntities();
        return {
          name,
          input: arg,
          output:
            entities.length === 0
              ? "No KB entities."
              : entities
                  .map(
                    (e) =>
                      `${e.entityId} · ${e.entityType} · v${e.latestVersion}`,
                  )
                  .join("\n"),
        };
      }
      case "read_markdown": {
        const entityId = arg || "liquid-copy";
        const doc = await this.getKBEntity(entityId);
        if (!doc.found || !doc.markdown) {
          return { name, input: entityId, output: `Not found: ${entityId}` };
        }
        const clipped =
          doc.markdown.length > 4000
            ? `${doc.markdown.slice(0, 4000)}\n…(truncated)`
            : doc.markdown;
        return { name, input: entityId, output: clipped };
      }
      case "search_rag": {
        const q = arg || "company brand voice";
        const passages = await this.search(q, { limit: 5 });
        return {
          name,
          input: q,
          output:
            passages.length === 0
              ? "No passages."
              : passages
                  .map(
                    (p) =>
                      `[${p.scope} ${(p.similarityScore * 100).toFixed(0)}%] ${p.sourceDoc}\n${p.content}`,
                  )
                  .join("\n\n"),
        };
      }
      case "generate_testing_plan":
      case "kickstart_plan": {
        await this.generateTestingPlan(arg || undefined);
        const plan = await this.getTestingPlan();
        return {
          name,
          input: arg || undefined,
          output: JSON.stringify(
            {
              message: "Testing plan generated.",
              roadmap: plan.roadmap ?? plan.roadmapText,
              hypotheses: plan.hypotheses,
            },
            null,
            2,
          ),
        };
      }
      case "update_testing_plan": {
        const parsed = tryParseJson<{
          roadmap?: RoadmapSummary;
          hypotheses?: HypothesisCard[];
          notes?: string;
        }>(arg);
        if (!parsed) {
          return {
            name,
            input: arg,
            output:
              "Expected JSON: { roadmap?, hypotheses?, notes? }. Query the plan first, then send updates.",
          };
        }
        const plan = await this.updateTestingPlan(parsed);
        return {
          name,
          output: JSON.stringify(
            {
              message: "Testing plan updated.",
              roadmap: plan.roadmap ?? plan.roadmapText,
              hypotheses: plan.hypotheses,
            },
            null,
            2,
          ),
        };
      }
      case "query_testing_plan":
      case "get_testing_plan": {
        const plan = await this.getTestingPlan();
        return {
          name,
          output: JSON.stringify(
            {
              roadmap: plan.roadmap ?? plan.roadmapText,
              hypotheses: plan.hypotheses,
            },
            null,
            2,
          ),
        };
      }
      case "queue_carousel": {
        const parsed = tryParseJson<{
          idea?: string;
          name?: string;
          audience?: string;
          platform?: string;
          tone?: string;
          cta?: string;
          slideCount?: number;
          aspectRatio?: "1:1" | "4:5" | "9:16";
          slides?: Array<{
            title: string;
            subtitle: string;
            role?: string;
            eyebrow?: string;
          }>;
        }>(arg);
        const idea = parsed?.idea?.trim() || arg;
        if (!idea) {
          return {
            name,
            output:
              'Provide an idea, e.g. JSON {"idea":"…","audience":"…","slides":[{"role":"hook","title":"…","subtitle":"…"}]}',
          };
        }
        const item = await this.queueCarouselFromIdea({
          idea,
          name: parsed?.name,
          audience: parsed?.audience,
          platform: parsed?.platform,
          tone: parsed?.tone,
          cta: parsed?.cta,
          slideCount: parsed?.slideCount,
          aspectRatio: parsed?.aspectRatio,
          slides: parsed?.slides as QueueOpenCarouselOptions["slides"],
        });
        return {
          name,
          input: idea.slice(0, 120),
          output: JSON.stringify(
            {
              ok: true,
              carouselId: item.id,
              name: item.name,
              slideCount: item.slideCount,
              message: `Queued. Review the Plan or ask Chat to publish.`,
            },
            null,
            2,
          ),
        };
      }
      case "list_pending_approvals": {
        const status = await this.getWorkflowStatus();
        const pending = status.checkpoints.filter((c) => c.status === "waiting");
        return {
          name,
          output:
            pending.length === 0
              ? "No pending approvals."
              : pending
                  .map(
                    (c) =>
                      `${c.stage}: ${(c.pendingOutput ?? "").slice(0, 200)}`,
                  )
                  .join("\n\n"),
        };
      }
      case "approve_checkpoint": {
        const stage = (arg || "RoadmapReview") as ApprovalCheckpointStage;
        await this.checkpointAction(stage, "approve");
        return { name, input: stage, output: `Approved ${stage}.` };
      }
      case "get_analytics": {
        const analytics = await this.getAnalytics();
        return {
          name,
          output: JSON.stringify(analytics, null, 2),
        };
      }
      case "save_to_rag": {
        const fromJson = tryParseJson<SaveToRagInput>(arg);
        let parsed =
          fromJson && fromJson.markdown
            ? {
                entityId: slugifyEntityId(fromJson.entityId) || "chat-note",
                entityType: fromJson.entityType || guessEntityType(fromJson.entityId),
                markdown: String(fromJson.markdown).trim(),
                append: Boolean(fromJson.append),
              }
            : parseSaveToRagIntent(`save_to_rag ${arg}`) ??
              parseSaveToRagIntent(arg);
        if (!parsed?.markdown && arg) {
          parsed = {
            entityId: "chat-note",
            entityType: "company_identity",
            markdown: arg,
            append: true,
          };
        }
        if (!parsed?.markdown) {
          return {
            name,
            input: arg,
            output:
              "Missing content. Try: Save to RAG as my-note: <markdown to store>",
          };
        }
        const saved = await this.saveToRag(parsed);
        return {
          name,
          input: `${saved.entityId} (${saved.entityType})`,
          output: `Saved to KB + RAG · ${saved.entityId} v${saved.versionNumber} · ${saved.entityType}${saved.append ? " (appended)" : ""}. Reindexed for retrieval.`,
        };
      }
      case "ingest_website": {
        const parsed = tryParseJson<{ url?: string }>(arg);
        const url = (parsed?.url ?? arg).trim();
        if (!url || url === "https://" || url === "http://") {
          return {
            name,
            output:
              'Provide a URL, e.g. JSON {"url":"https://example.com"} or the bare URL.',
          };
        }
        const result = await this.ingestWebsite(url);
        return {
          name,
          input: url,
          output: JSON.stringify(result, null, 2),
        };
      }
      default:
        return { name, input: arg, output: `Unknown tool: ${name}` };
    }
  },

  /**
   * Main agent chat — Vercel AI SDK ToolLoopAgent (model picks tools).
   */
  async agentChat(
    history: ChatMessage[],
    options?: { scope?: RetrievalScope },
  ): Promise<AgentChatResult> {
    const llm = loadSettings().llm;
    const lastUser =
      [...history].reverse().find((m) => m.role === "user")?.content?.trim() ??
      "";
    if (!lastUser) {
      throw new Error("No user message to answer.");
    }

    const gathered = await this.gatherRagMarkdownContext(lastUser, {
      scope: options?.scope,
      limit: 6,
    });
    const passages = [...gathered.passages];
    const markdownSources = [...gathered.markdownSources];

    const { reply, tools } = await runLiquidCopyAgent({
      llm,
      history,
      passages,
      markdownSources,
      deps: {
        listKBEntities: () => this.listKBEntities(),
        getKBEntity: (id) => this.getKBEntity(id),
        search: (q, opts) => this.search(q, opts),
        generateTestingPlan: (focus) => this.generateTestingPlan(focus),
        updateTestingPlan: (input) => this.updateTestingPlan(input),
        getTestingPlan: () => this.getTestingPlan(),
        queueCarouselFromIdea: (input) => this.queueCarouselFromIdea(input),
        getWorkflowStatus: () => this.getWorkflowStatus(),
        checkpointAction: (stage, action) =>
          this.checkpointAction(stage, action),
        getAnalytics: () => this.getAnalytics(),
        saveToRag: (input) => this.saveToRag(input),
        ingestWebsite: (url) => this.ingestWebsite(url),
      },
    });

    return {
      reply,
      passages,
      markdownSources,
      tools,
      model: llm.model,
      provider: llm.provider,
    };
  },

  async listKBEntities(): Promise<KBEntitySummary[]> {
    if (useLive()) {
      const raw = await liveFetch<{ entities?: KBEntitySummary[] }>(
        "/api/content-creator-ai/knowledge-base",
      );
      return Array.isArray(raw.entities) ? raw.entities : [];
    }
    return demoStore.listKBEntities();
  },

  async getKBEntity(entityId: string): Promise<KBDocumentView> {
    if (useLive()) {
      try {
        const raw = await liveFetch<{
          entityId: string;
          found: boolean;
          markdown?: string;
        }>(
          `/api/content-creator-ai/knowledge-base?entityId=${encodeURIComponent(entityId)}`,
        );
        return {
          entityId: raw.entityId,
          found: Boolean(raw.found),
          markdown: raw.markdown,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (
          message.includes("404") ||
          message.includes("not found") ||
          message.includes('"found":false')
        ) {
          return { entityId, found: false };
        }
        throw e;
      }
    }
    return demoStore.readKBEntity(entityId);
  },

  async getKnowledgeStatus(): Promise<{
    entityCount: number;
    indexedDocuments: number;
    entityIds: string[];
    storagePath: string;
  }> {
    if (!useLive()) {
      return {
        entityCount: 0,
        indexedDocuments: 0,
        entityIds: [],
        storagePath: "(simulation)",
      };
    }
    return liveFetch("/api/content-creator-ai/knowledge-base");
  },

  async clearKnowledge(): Promise<{ removed: string[] }> {
    if (!useLive()) return { removed: [] };
    return liveFetch("/api/content-creator-ai/knowledge-base", {
      method: "DELETE",
      body: JSON.stringify({ confirm: true }),
    });
  },

  /**
   * Write markdown into the KB. Live mode uses PUT (kb.updated → RAG reindex).
   * Simulation updates the in-memory demo KB + searchable passages.
   */
  async saveToRag(input: SaveToRagInput): Promise<{
    entityId: string;
    entityType: KBWriteEntityType;
    versionNumber: number;
    append: boolean;
  }> {
    const entityId = slugifyEntityId(input.entityId) || "chat-note";
    const entityType = input.entityType ?? guessEntityType(entityId);
    let markdown = input.markdown.trim();
    if (!markdown) throw new Error("Nothing to save — markdown is empty.");
    if (markdown.length > MAX_MD_CHARS) {
      markdown = `${markdown.slice(0, MAX_MD_CHARS)}\n\n…(truncated for KB write)`;
    }

    const append = Boolean(input.append);
    if (append) {
      const existing = await this.getKBEntity(entityId);
      if (existing.found && existing.markdown?.trim()) {
        markdown = `${existing.markdown.trim()}\n\n---\n\n${markdown}`;
      }
    }

    if (useLive()) {
      await this.syncConfig();
      const raw = await liveFetch<{
        versionNumber?: number;
        kbVersion?: string;
      }>("/api/content-creator-ai/knowledge-base", {
        method: "PUT",
        body: JSON.stringify({
          entityId,
          entityType,
          markdown,
          modifiedFields: ["markdown"],
        }),
      });
      return {
        entityId,
        entityType,
        versionNumber: raw.versionNumber ?? 1,
        append,
      };
    }

    const saved = demoStore.writeKBEntity({
      entityId,
      entityType,
      markdown,
      append: false, // already merged above when append
    });
    return {
      entityId: saved.entityId,
      entityType,
      versionNumber: saved.versionNumber,
      append,
    };
  },

  async ingestCompany(companyUrl: string): Promise<unknown> {
    if (isDemoWorkspace()) {
      throw new Error(
        "Ingest needs real data mode. Enable it under Settings → Use real data.",
      );
    }
    const base = getApiBaseUrl();
    if (!base) {
      throw new Error(
        "Set the Liquid Copy API base URL in Settings (default http://localhost:8787) and run npm run api:dev.",
      );
    }
    if (!companyUrl || companyUrl === "https://" || companyUrl === "http://") {
      throw new Error("Enter a full company URL (e.g. https://example.com).");
    }
    const settings = loadSettings();
    if (!settings.firecrawlApiKey.trim()) {
      throw new Error(
        "Add a Firecrawl API key in Settings, Save, then retry ingest.",
      );
    }
    if (settings.lastFirecrawlUrl !== companyUrl) {
      saveSettings({ ...settings, lastFirecrawlUrl: companyUrl });
    }
    await this.syncConfig();
    const drafted = await liveFetch<{
      status?: string;
      draftId?: string;
      warnings?: string[];
      companySummary?: { name?: string };
      kbVersion?: string;
    }>("/api/content-creator-ai/ingest", {
      method: "POST",
      body: JSON.stringify({ companyUrl }),
      signal: AbortSignal.timeout(180_000),
    });

    // URL scrapes return a review draft — auto-commit so Knowledge search works.
    if (drafted.draftId && drafted.status !== "firecrawl_error") {
      return liveFetch("/api/content-creator-ai/ingest", {
        method: "POST",
        body: JSON.stringify({ action: "accept", draftId: drafted.draftId }),
        signal: AbortSignal.timeout(60_000),
      });
    }
    return drafted;
  },

  /**
   * Agent-facing Firecrawl ingest: scrape URL → company markdown KB → RAG.
   * Wraps ingestCompany with a stable success/error shape for tools.
   */
  async ingestWebsite(url: string): Promise<{
    ok: boolean;
    url: string;
    status?: string;
    name?: string;
    kbVersion?: string;
    warnings?: string[];
    message: string;
  }> {
    const normalized = url.trim();
    try {
      const raw = (await this.ingestCompany(normalized)) as {
        status?: string;
        warnings?: string[];
        companySummary?: { name?: string };
        kbVersion?: string;
        draftId?: string;
      };

      if (raw.status === "firecrawl_error") {
        const warning =
          raw.warnings?.[0] ??
          "Firecrawl could not scrape that URL. Check the key and try again.";
        return {
          ok: false,
          url: normalized,
          status: raw.status,
          warnings: raw.warnings,
          message: warning,
        };
      }

      const name = raw.companySummary?.name?.trim();
      const kbVersion = raw.kbVersion;
      return {
        ok: true,
        url: normalized,
        status: raw.status ?? "accepted",
        name,
        kbVersion,
        warnings: raw.warnings,
        message: [
          "Ingested via Firecrawl into KB + RAG",
          name ? `· ${name}` : null,
          kbVersion ? `· KB ${kbVersion}` : null,
          "· searchable in Knowledge / chat",
        ]
          .filter(Boolean)
          .join(" "),
      };
    } catch (e) {
      return {
        ok: false,
        url: normalized,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },

  async listExperiments(): Promise<ExperimentCard[]> {
    if (!useLive()) return demoStore.listExperiments();

    const byId = new Map<string, ExperimentCard>();

    for (const exp of simulatedPublishesToExperimentCards()) {
      byId.set(exp.id, exp);
    }

    for (const c of listQueuedCarousels()) {
      const id = c.postVariantId || c.id;
      if (byId.has(id)) continue;
      // Already covered by a simulated publish for this carousel
      if (
        [...byId.keys()].some((k) => k.includes(c.id.slice(0, 12))) ||
        simulatedPublishesToExperimentCards().some((s) =>
          s.id.includes(c.id.slice(0, 12)),
        )
      ) {
        continue;
      }
      const status =
        c.status === "published"
          ? ("published" as const)
          : c.status === "draft"
            ? ("draft" as const)
            : c.status === "failed"
              ? ("failed" as const)
              : ("queued" as const);
      byId.set(id, {
        id,
        title: c.name,
        hook: c.caption?.slice(0, 160) || c.name,
        platform: (loadSettings().zernioPlatform ||
          "linkedin") as SocialPlatform,
        status,
        updatedAt: c.publishedAt || c.updatedAt || new Date().toISOString(),
      });
    }

    try {
      const status = await this.getWorkflowStatus();
      const content = status.stages.find((s) => s.stage === "ContentGeneration");
      const variants = content?.output?.variants;
      if (Array.isArray(variants)) {
        for (const raw of variants) {
          if (!raw || typeof raw !== "object") continue;
          const v = raw as {
            id?: string;
            carouselId?: string;
            caption?: string;
            platform?: string;
            status?: string;
            hypothesisId?: string;
          };
          const id = v.id || v.carouselId;
          if (!id || byId.has(id)) continue;
          byId.set(id, {
            id,
            title: v.caption?.slice(0, 80) || `Variant ${id.slice(0, 8)}`,
            hook: v.caption?.slice(0, 160) || v.hypothesisId || id,
            platform: (v.platform ||
              loadSettings().zernioPlatform ||
              "linkedin") as SocialPlatform,
            status:
              v.status === "published"
                ? "published"
                : v.status === "queued"
                  ? "queued"
                  : "draft",
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch {
      /* status optional */
    }

    return [...byId.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  },

  /**
   * Generate / regenerate testing plan (roadmap + hypotheses).
   * Simulation: reset demo plan. Real: run workflow pipeline.
   */
  async kickstartPlan(focus?: string): Promise<WorkflowStatus> {
    if (useLive()) {
      await this.syncConfig();
      return this.runWorkflow();
    }
    return demoStore.kickstartPlan(focus);
  },

  /** Alias used by agent tools. */
  async generateTestingPlan(focus?: string): Promise<WorkflowStatus> {
    return this.kickstartPlan(focus);
  },

  /**
   * Update roadmap and/or hypotheses. Simulation mutates demo store;
   * live mode edits RoadmapReview / HypothesisReview checkpoints.
   */
  async updateTestingPlan(input: {
    roadmap?: RoadmapSummary;
    hypotheses?: HypothesisCard[];
    notes?: string;
  }): Promise<{
    roadmap: RoadmapSummary | null;
    roadmapText: string | null;
    hypotheses: HypothesisCard[];
  }> {
    if (!input.roadmap && !input.hypotheses) {
      throw new Error("Provide roadmap and/or hypotheses to update.");
    }

    if (!useLive()) {
      demoStore.updateTestingPlan({
        roadmap: input.roadmap,
        hypotheses: input.hypotheses,
      });
      return this.getTestingPlan();
    }

    await this.syncConfig();
    if (input.roadmap) {
      await this.checkpointAction("RoadmapReview", "edit", {
        notes: JSON.stringify(input.roadmap, null, 2),
      });
    }
    if (input.hypotheses) {
      await this.checkpointAction("HypothesisReview", "edit", {
        notes: JSON.stringify(input.hypotheses, null, 2),
      });
    }
    if (input.notes?.trim() && !input.roadmap && !input.hypotheses) {
      await this.checkpointAction("RoadmapReview", "edit", {
        notes: input.notes.trim(),
      });
    }
    return this.getTestingPlan();
  },

  async getTestingPlan(): Promise<{
    roadmap: RoadmapSummary | null;
    roadmapText: string | null;
    hypotheses: HypothesisCard[];
  }> {
    // Prefer Plan-tab 7-day snapshot (works without workflow checkpoints).
    const sevenDay = loadSevenDayPlanSnapshot();
    if (sevenDay) {
      return {
        roadmap: sevenDay.roadmap,
        roadmapText: null,
        hypotheses: sevenDay.hypotheses,
      };
    }

    if (!useLive()) {
      return {
        roadmap: demoStore.getRoadmapSummary(),
        roadmapText: null,
        hypotheses: demoStore.getHypotheses(),
      };
    }
    const status = await this.getWorkflowStatus();
    const roadmapCp = status.checkpoints.find(
      (c) => c.stage === "RoadmapReview",
    );
    const hypCp = status.checkpoints.find(
      (c) => c.stage === "HypothesisReview",
    );
    const roadmapStage = status.stages.find(
      (s) => s.stage === "RoadmapGeneration",
    );
    const hypStage = status.stages.find(
      (s) => s.stage === "HypothesisGeneration",
    );

    let roadmap: RoadmapSummary | null = null;
    let roadmapText: string | null = null;

    if (roadmapCp?.pendingOutput) {
      const fromCp = tryParseRoadmap(roadmapCp.pendingOutput);
      if (fromCp) roadmap = fromCp;
      else roadmapText = roadmapCp.pendingOutput;
    }
    if (!roadmap && roadmapStage?.output?.roadmap) {
      roadmap = roadmapFromEngine(roadmapStage.output.roadmap);
    }
    if (!roadmap && !roadmapText && roadmapStage?.summary) {
      roadmapText = roadmapStage.summary;
    }

    let hypotheses: HypothesisCard[] = [];
    if (hypCp?.pendingOutput) {
      try {
        const parsed = JSON.parse(hypCp.pendingOutput) as HypothesisCard[];
        if (Array.isArray(parsed)) hypotheses = parsed;
      } catch {
        hypotheses = [
          {
            id: "hyp-live",
            hook: hypCp.pendingOutput.slice(0, 160),
            platform: status.platforms[0] ?? "linkedin",
            status: "draft_review",
          },
        ];
      }
    }
    if (hypotheses.length === 0) {
      const fromStage = hypothesisFromEngine(
        hypStage?.output,
        status.platforms[0] ?? "linkedin",
      );
      if (fromStage) hypotheses = [fromStage];
    }
    return { roadmap, roadmapText, hypotheses };
  },

  async getPlanHistory(): Promise<PlanChangeRecord[]> {
    if (!useLive()) return demoStore.getPlanHistory();
    const status = await this.getWorkflowStatus();
    return status.checkpoints
      .filter(
        (c) =>
          (PLAN_CHECKPOINT_STAGES as readonly string[]).includes(c.stage) &&
          (c.status === "approved" ||
            c.status === "edited" ||
            c.status === "rejected"),
      )
      .map((c, i) => ({
        id: `hist-${c.stage}-${i}`,
        stage: c.stage,
        action: c.status,
        summary: c.pendingOutput?.slice(0, 240) || `${c.stage} → ${c.status}`,
        at: new Date().toISOString(),
      }));
  },

  async getTopContent(limit = 5): Promise<InsightPiece[]> {
    if (!useLive()) return demoStore.getTopContent(limit);
    const passages = await this.search(
      "winning hooks experiment outcomes best content",
    );
    return passages.slice(0, limit).map((p, i) => ({
      id: `kb-${i}`,
      title: p.sourceDoc,
      hook: p.content.slice(0, 120),
      platform: "linkedin",
      status: "won" as const,
      note: p.scope,
    }));
  },

  async getAnalytics(): Promise<AnalyticsSummary> {
    if (!useLive()) return demoStore.getAnalytics();

    const experiments = await this.listExperiments();
    const passages = await this.search(
      "winning hooks experiment outcomes engagement metrics",
      { scope: "experiment_history", limit: 8 },
    );
    const simulated = simulatedPublishesToAnalyticsRows();

    const rows: AnalyticsRow[] = [
      ...simulated,
      ...experiments.map((e) => ({
        id: e.id,
        title: e.title,
        hook: e.hook,
        platform: e.platform,
        status: e.status,
        impressions: 0,
        engagementRate: 0,
        ctr: 0,
        saves: 0,
        shares: 0,
        comments: 0,
        winner: e.status === "won",
        note: passages.find((p) => p.sourceDoc.includes(e.id))?.content.slice(0, 160),
      })),
    ];

    if (rows.length === 0 && passages.length > 0) {
      for (const [i, p] of passages.entries()) {
        rows.push({
          id: `kb-${i}`,
          title: p.sourceDoc,
          hook: p.content.slice(0, 120),
          platform: "linkedin",
          status: "won",
          impressions: 0,
          engagementRate: p.similarityScore,
          ctr: 0,
          saves: 0,
          shares: 0,
          comments: 0,
          note: p.content.slice(0, 200),
        });
      }
    }

    const winner =
      rows.find((r) => r.winner) ??
      rows.find((r) => r.impressions > 0) ??
      rows[0];
    const hasSim = simulated.length > 0;
    return {
      rows,
      winnerId: winner?.id,
      inconclusive: rows.every((r) => r.impressions === 0),
      summary:
        passages[0]?.content.slice(0, 280) ??
        (hasSim
          ? `${simulated.length} simulated Zernio publish(es) with demo metrics.`
          : rows.length
            ? `${rows.length} experiment rows loaded. Configure Zernio for live metrics, or use Simulate Zernio on Test.`
            : "No analytics yet — publish experiments, Simulate Zernio on Test, or connect Zernio."),
      updatedAt: new Date().toISOString(),
    };
  },

  /**
   * Queue a carousel from an idea/concept (agent or Test tab).
   * Drafts a strong slide outline via LLM when slides are thin/missing,
   * grounds copy in RAG/KB when available, then seeds Open Carrusel.
   */
  async queueCarouselFromIdea(
    input: QueueOpenCarouselOptions & {
      idea: string;
      slideCount?: number;
    },
  ): Promise<OpenCarouselItem> {
    const idea = input.idea.trim();
    if (!idea) throw new Error("Provide an idea or concept to queue a carousel.");

    let slides = input.slides;
    let name = input.name?.trim() || undefined;

    // Upgrade thin/missing outlines with an LLM draft grounded in KB context.
    if (!slides || slides.length < 4) {
      const gathered = await this.gatherRagMarkdownContext(idea, {
        limit: 4,
      }).catch(() => ({ passages: [], markdownSources: [] }));
      const context = [
        ...gathered.markdownSources.map(
          (m) => `[${m.entityId}]\n${m.markdown.slice(0, 900)}`,
        ),
        ...gathered.passages.map(
          (p) => `[rag:${p.sourceDoc}]\n${p.content.slice(0, 400)}`,
        ),
      ]
        .join("\n\n")
        .slice(0, 3500);

      const drafted = await draftCarouselBriefs(loadSettings().llm, {
        idea,
        name,
        audience: input.audience,
        platform: input.platform,
        tone: input.tone,
        cta: input.cta,
        slideCount: input.slideCount ?? 5,
        context,
      });
      slides = drafted.slides;
      name = name || drafted.name;
    }

    const options: QueueOpenCarouselOptions = {
      idea,
      name,
      aspectRatio: input.aspectRatio,
      audience: input.audience,
      platform: input.platform,
      tone: input.tone,
      cta: input.cta,
      slides,
      hypothesisId: input.hypothesisId,
      scheduledAt: input.scheduledAt,
    };

    let item: OpenCarouselItem;
    if (!useLive()) {
      item = buildDemoQueuedCarousel(options);
    } else {
      const baseUrl = loadSettings().openCarouselBaseUrl;
      item = await queueOpenCarousel(baseUrl, options);
    }
    upsertQueuedCarousel(item);
    return item;
  },

  /**
   * Real-mode Plan tab: RAG → Ollama hypotheses for the next 7 days →
   * one carousel per hypothesis, shown on the Plan page.
   */
  async generateSevenDayPlan(options?: {
    onProgress?: (msg: string) => void;
  }): Promise<{
    plan: WeekPostingPlan;
    carousels: OpenCarouselItem[];
    hypotheses: HypothesisCard[];
    roadmap: RoadmapSummary;
    markdown: string;
  }> {
    const llm = loadSettings().llm;
    options?.onProgress?.("Retrieving RAG + KB context…");
    const { passages, markdownSources } = await this.gatherRagMarkdownContext(
      "content experiment hypotheses hooks audience platforms next seven days",
      { limit: 8 },
    );

    const passageBlock =
      passages.length === 0
        ? "(No RAG passages — invent grounded B2B/content-marketing tests.)"
        : passages
            .map(
              (p, i) =>
                `[${i + 1}] ${p.sourceDoc}: ${p.content.slice(0, 420)}`,
            )
            .join("\n\n");
    const markdownBlock =
      markdownSources.length === 0
        ? "(No KB markdown.)"
        : markdownSources
            .map((m) => `--- ${m.entityId} ---\n${m.markdown.slice(0, 1200)}`)
            .join("\n\n");

    options?.onProgress?.(
      `Drafting 7 hypotheses with ${llm.provider}/${llm.model}…`,
    );
    const prompt = `You are Liquid Copy's experimentation planner. Using ONLY the company context below, invent exactly 7 distinct content hypotheses to test over the next 7 days (one per day).

Return ONLY a JSON array (no prose) of 7 objects:
[{"title":"short name","hook":"scroll-stopping first line","angle":"why this might win","platform":"linkedin|instagram|tiktok|threads|x"}]

Rules:
- Hooks must be specific to this company/audience, not generic marketing fluff
- Vary platforms when context allows; default linkedin
- Each hypothesis must be testable in a short carousel

RAG passages:
${passageBlock}

KB markdown:
${markdownBlock}

JSON:`;

    let hypotheses: HypothesisCard[] = [];
    try {
      const raw = await completeWithSettings(llm, prompt);
      hypotheses = parseHypothesesJson(raw);
    } catch {
      hypotheses = [];
    }

    if (hypotheses.length === 0) {
      // Fallback: derive hooks from top RAG snippets so the UI still fills.
      const seeds =
        passages.length > 0
          ? passages.slice(0, 7)
          : markdownSources.slice(0, 7).map((m) => ({
              content: m.markdown.slice(0, 160),
              sourceDoc: m.entityId,
              similarityScore: 0,
              scope: "identity" as const,
            }));
      hypotheses = Array.from({ length: 7 }, (_, i) => {
        const seed = seeds[i % Math.max(seeds.length, 1)];
        const snippet =
          seed && "content" in seed
            ? String(seed.content).replace(/\s+/g, " ").trim().slice(0, 100)
            : "Prove one concrete claim this week";
        return {
          id: `hyp-7d-fallback-${Date.now().toString(36)}-${i}`,
          title: `Day ${i + 1} test`,
          hook: snippet.endsWith("?") ? snippet : `${snippet}?`,
          angle: "Derived from knowledge base when the model returned no JSON.",
          platform: PLAN_PLATFORMS[i % PLAN_PLATFORMS.length]!,
          status: "queued" as const,
        };
      });
    }

    while (hypotheses.length < 7) {
      const i = hypotheses.length;
      hypotheses.push({
        id: `hyp-7d-pad-${Date.now().toString(36)}-${i}`,
        title: `Day ${i + 1} test`,
        hook: "What if we named the friction your buyers feel every Monday?",
        angle: "Pad slot so the week has one carousel per day.",
        platform: PLAN_PLATFORMS[i % PLAN_PLATFORMS.length]!,
        status: "queued",
      });
    }
    hypotheses = hypotheses.slice(0, 7);

    const roadmap = roadmapFromSevenDayHyps(hypotheses);
    // Persist locally — do not require workflow checkpoints (RoadmapReview idle).
    options?.onProgress?.("Saving hypotheses + 7-day roadmap…");
    saveSevenDayPlanSnapshot({ roadmap, hypotheses });

    const built = await this.generateWeekPostingPlan({
      onProgress: options?.onProgress,
      hypotheses,
      startFrom: "today",
    });

    return {
      ...built,
      hypotheses,
      roadmap,
    };
  },

  /**
   * Take hypotheses → 7-day posting schedule → carousel per hyp.
   */
  async generateWeekPostingPlan(options?: {
    onProgress?: (msg: string) => void;
    /** Prefer these hypotheses instead of reloading from getTestingPlan. */
    hypotheses?: HypothesisCard[];
    /** Schedule from today (next 7 days) or from Monday. Default monday. */
    startFrom?: "today" | "monday";
  }): Promise<{
    plan: WeekPostingPlan;
    carousels: OpenCarouselItem[];
    hypotheses: HypothesisCard[];
    markdown: string;
  }> {
    const loaded = options?.hypotheses?.length
      ? { hypotheses: options.hypotheses }
      : await this.getTestingPlan();
    const hypotheses = loaded.hypotheses;
    if (hypotheses.length === 0) {
      throw new Error(
        "No hypotheses yet. Generate a plan first, or add hypotheses via Chat.",
      );
    }

    const testable = hypotheses.filter(
      (h) => h.status !== "won" && h.status !== "failed",
    );
    const selected = (testable.length > 0 ? testable : hypotheses).slice(0, 7);
    const weekStart =
      options?.startFrom === "today" ? startOfToday() : startOfWeekMonday();
    const slots: PostingPlanSlot[] = [];
    const carousels: OpenCarouselItem[] = [];

    for (let i = 0; i < selected.length; i++) {
      const hyp = selected[i]!;
      const dayIndex = i;
      const scheduled = new Date(weekStart);
      scheduled.setDate(weekStart.getDate() + dayIndex);
      const scheduledAt = scheduled.toISOString();
      const dayLabel = scheduled.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      options?.onProgress?.(
        `Carousel ${i + 1}/${selected.length}: ${hyp.title ?? hyp.hook}`,
      );

      let carousel = findQueuedByHypothesisId(hyp.id);
      if (!carousel) {
        const idea = [hyp.hook, hyp.angle].filter(Boolean).join(" — ");
        const name = hyp.title?.trim() || hyp.hook.slice(0, 64);
        const slides = briefsFromIdea(idea, name, { platform: hyp.platform });
        carousel = await this.queueCarouselFromIdea({
          idea,
          name,
          platform: hyp.platform,
          aspectRatio: aspectForPlatform(hyp.platform),
          slides,
          hypothesisId: hyp.id,
          scheduledAt,
        });
      } else if (carousel.scheduledAt !== scheduledAt) {
        carousel = { ...carousel, scheduledAt };
        upsertQueuedCarousel(carousel);
      }

      carousels.push(carousel);
      slots.push({
        id: `slot-${hyp.id}`,
        hypothesisId: hyp.id,
        dayIndex,
        dayLabel,
        scheduledAt,
        platform: hyp.platform,
        hypothesisTitle: hyp.title ?? hyp.hook,
        hook: hyp.hook,
        carouselId: carousel.id,
      });
    }

    const plan: WeekPostingPlan = {
      weekStart: weekStart.toISOString(),
      summary: `${slots.length} hypothesis test${slots.length === 1 ? "" : "s"} over the next 7 days — one carousel each.`,
      slots,
      createdAt: new Date().toISOString(),
    };
    saveWeekPostingPlan(plan);

    options?.onProgress?.("Saving central plan document (testing-plan.md)…");
    const markdown = formatCentralPlanMarkdown({
      plan,
      hypotheses,
      carousels,
    });
    try {
      await this.saveToRag({
        entityId: CENTRAL_PLAN_ENTITY_ID,
        entityType: "company_identity",
        markdown,
        append: false,
      });
    } catch {
      // Plan UI still works from localStorage if KB write fails.
    }

    return { plan, carousels, hypotheses, markdown };
  },

  getWeekPostingPlan(): {
    plan: WeekPostingPlan | null;
    carousels: OpenCarouselItem[];
  } {
    const plan = loadWeekPostingPlan();
    if (!plan) return { plan: null, carousels: [] };
    const byId = new Map(listQueuedCarousels().map((c) => [c.id, c]));
    const carousels = plan.slots
      .map((s) => byId.get(s.carouselId))
      .filter((c): c is OpenCarouselItem => Boolean(c));
    return { plan, carousels };
  },

  /** Load the one central plan markdown (+ structured week plan when present). */
  async getCentralPlanDocument(): Promise<{
    entityId: string;
    markdown: string | null;
    plan: WeekPostingPlan | null;
    carousels: OpenCarouselItem[];
  }> {
    const doc = await this.getKBEntity(CENTRAL_PLAN_ENTITY_ID);
    const markdown =
      doc.found && doc.markdown?.trim() ? doc.markdown.trim() : null;
    const fromMd = markdown ? parseCentralPlanMarkdown(markdown) : null;
    const cached = loadWeekPostingPlan();
    const plan = fromMd ?? cached;
    if (plan) saveWeekPostingPlan(plan);
    const byId = new Map(listQueuedCarousels().map((c) => [c.id, c]));
    const carousels = plan
      ? plan.slots
          .map((s) => byId.get(s.carouselId))
          .filter((c): c is OpenCarouselItem => Boolean(c))
      : [];
    return {
      entityId: CENTRAL_PLAN_ENTITY_ID,
      markdown,
      plan,
      carousels,
    };
  },

  /**
   * Queue every carousel in the current week plan to Zernio (one after another).
   * Simulation / missing key → simulated publishes. Skips already published.
   */
  async queueWeekPlanToZernio(options?: {
    simulate?: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<{
    ok: boolean;
    queued: number;
    skipped: number;
    failed: number;
    carousels: OpenCarouselItem[];
    message: string;
  }> {
    const { plan, carousels } = this.getWeekPostingPlan();
    if (!plan || carousels.length === 0) {
      throw new Error("No week plan carousels to queue. Build the week plan first.");
    }

    const forceSimulate = options?.simulate === true || !useLive();
    let queued = 0;
    let skipped = 0;
    let failed = 0;
    const updated: OpenCarouselItem[] = [];

    for (let i = 0; i < carousels.length; i++) {
      const carousel = carousels[i]!;
      if (carousel.status === "published") {
        skipped += 1;
        updated.push(carousel);
        continue;
      }

      options?.onProgress?.(
        `Queuing ${i + 1}/${carousels.length} to Zernio: ${carousel.name}`,
      );
      patchQueuedCarousel(carousel.id, { status: "publishing" });

      try {
        const result = await this.publishCarouselToZernio(carousel, {
          simulate: forceSimulate,
        });
        const status = !result.ok
          ? ("failed" as const)
          : result.mode === "draft"
            ? ("draft" as const)
            : ("published" as const);
        const patch = {
          status,
          postVariantId: result.postVariantId,
          publishedAt: result.publishedAt,
          publishMessage: result.message,
        };
        patchQueuedCarousel(carousel.id, patch);
        updated.push({ ...carousel, ...patch });
        if (result.ok) queued += 1;
        else failed += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const patch = {
          status: "failed" as const,
          publishMessage: message,
        };
        patchQueuedCarousel(carousel.id, patch);
        updated.push({ ...carousel, ...patch });
        failed += 1;
      }
    }

    const modeLabel = forceSimulate ? "simulated in Zernio" : "queued in Zernio";
    const message = [
      `${queued} ${modeLabel}`,
      skipped ? `${skipped} already published` : null,
      failed ? `${failed} failed` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      ok: failed === 0,
      queued,
      skipped,
      failed,
      carousels: updated,
      message,
    };
  },

  /**
   * Queue a new Open Carrusel deck for the Test tab (generic / no idea).
   */
  async queueTestCarousel(idea?: string): Promise<OpenCarouselItem> {
    if (idea?.trim()) {
      return this.queueCarouselFromIdea({ idea: idea.trim() });
    }
    if (!useLive()) {
      const template =
        DEMO_QUEUED_CAROUSELS[
          Math.floor(Math.random() * DEMO_QUEUED_CAROUSELS.length)
        ] ?? DEMO_QUEUED_CAROUSELS[0];
      const id = `demo-oc-${Date.now().toString(36)}`;
      const item: OpenCarouselItem = {
        ...template,
        id,
        name: `Test queue ${new Date().toLocaleTimeString()}`,
        status: "queued",
        updatedAt: new Date().toISOString(),
        slides: template.slides.map((s, i) => ({
          ...s,
          id: `${id}-s${i}`,
        })),
        postVariantId: undefined,
        publishedAt: undefined,
        publishMessage: undefined,
      };
      upsertQueuedCarousel(item);
      return item;
    }
    const baseUrl = loadSettings().openCarouselBaseUrl;
    const item = await queueOpenCarousel(baseUrl);
    upsertQueuedCarousel(item);
    return item;
  },

  /**
   * Publish a carousel to Zernio as a multi-image post:
   * Open Carrusel PNG export → Zernio media presign/upload → POST /v1/posts.
   * Pass `{ simulate: true }` to skip the real API (works in real-data mode).
   */
  async publishCarouselToZernio(
    carousel: OpenCarouselItem,
    options?: { simulate?: boolean },
  ): Promise<{
    ok: boolean;
    mode: "live" | "draft" | "recorded" | "simulation";
    postVariantId: string;
    publishedAt: string;
    message: string;
    zernioPostId?: string;
    platformPostUrl?: string;
    mediaCount?: number;
  }> {
    const postVariantId =
      carousel.postVariantId ||
      `pv-${carousel.id.slice(0, 20)}-${Date.now().toString(36)}`;

    const forceSimulate = options?.simulate === true || !useLive();
    if (forceSimulate) {
      const s = loadSettings();
      const sim = recordSimulatedPublish({
        carouselId: carousel.id,
        name: carousel.name,
        postVariantId,
        platform: s.zernioPlatform || "linkedin",
        caption: carousel.caption,
      });
      return {
        ok: true,
        mode: "simulation",
        postVariantId,
        publishedAt: sim.publishedAt,
        message: `Simulated Zernio publish · ${carousel.slideCount || carousel.slides?.length || 0} slides · ${sim.impressions.toLocaleString()} impressions · ${(sim.engagementRate * 100).toFixed(1)}% engagement (demo metrics).`,
        zernioPostId: `sim-post-${sim.id}`,
        mediaCount: carousel.slideCount || carousel.slides?.length || 0,
      };
    }

    const s = loadSettings();
    if (!s.zernioApiKey.trim()) {
      throw new Error(
        "Zernio API key missing — use Simulate Zernio, or add a key in Settings and retry live publish.",
      );
    }
    if (!s.openCarouselBaseUrl.trim()) {
      throw new Error(
        "Set Open Carrusel base URL in Settings so slides can be exported to PNG before Zernio publish.",
      );
    }

    try {
      await this.syncConfig();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Could not sync Settings to API before Zernio publish. ${msg}`,
      );
    }

    const slideTexts = (carousel.slides ?? [])
      .map((slide) =>
        slide.html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);

    try {
      const raw = await liveFetch<{
        ok?: boolean;
        mode?: "live" | "draft" | "recorded";
        postVariantId?: string;
        publishedAt?: string;
        message?: string;
        zernioPostId?: string;
        platformPostUrl?: string;
        mediaCount?: number;
      }>("/api/content-creator-ai/zernio/publish", {
        method: "POST",
        // PNG export + media uploads can take a while (Puppeteer).
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          postVariantId,
          carouselId: carousel.id,
          name: carousel.name,
          caption: carousel.caption,
          platform: s.zernioPlatform || "linkedin",
          accountId: s.zernioAccountId || undefined,
          publishNow: true,
          aspectRatio: carousel.aspectRatio,
          slideCount: carousel.slideCount,
          slideTexts,
          openCarouselBaseUrl: s.openCarouselBaseUrl,
        }),
      });

      return {
        ok: Boolean(raw.ok),
        mode: raw.mode ?? "recorded",
        postVariantId: raw.postVariantId ?? postVariantId,
        publishedAt: raw.publishedAt ?? new Date().toISOString(),
        message: raw.message ?? "Zernio response received",
        zernioPostId: raw.zernioPostId,
        platformPostUrl: raw.platformPostUrl,
        mediaCount: raw.mediaCount,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/No route for POST .*zernio\/publish/i.test(msg)) {
        throw new Error(
          "API is missing /zernio/publish — restart with npm run api:dev (or npm run dev:stack) so the new route loads. Or use Simulate Zernio.",
        );
      }
      throw e;
    }
  },

  async getOrganization(): Promise<OrganizationContext> {
    if (!useLive()) {
      return {
        profile: demoStore.getOrgProfile(),
        goal: demoStore.getOrgGoal(),
      };
    }

    const status = await this.getWorkflowStatus();
    const contextCp = status.checkpoints.find((c) => c.stage === "ContextReview");
    const goalCp = status.checkpoints.find((c) => c.stage === "GoalReview");

    let profile = tryParseJson<OrgProfile>(contextCp?.pendingOutput);
    let goal = tryParseJson<OrgGoal>(goalCp?.pendingOutput);

    if (!profile) {
      const passages = await this.search("company brand voice mission identity", {
        scope: "company_memory",
      });
      const company = passages[0];
      if (company) {
        profile = {
          name: company.sourceDoc.replace(/_/g, " "),
          mission: company.content.slice(0, 280),
          brandVoice: company.content.slice(0, 200),
          values: [],
        };
      }
    }

    if (!goal && goalCp?.pendingOutput) {
      goal = {
        id: "goal-live",
        primaryObjective: goalCp.pendingOutput.slice(0, 280),
        targetPlatform: status.platforms[0] ?? "linkedin",
        status:
          goalCp.status === "approved" || goalCp.status === "edited"
            ? "accepted"
            : "proposed",
        successMetrics: [],
      };
    }

    return { profile, goal };
  },

  async generateInsightAnalysis(
    pieces: InsightPiece[],
    passages: RAGPassage[],
  ): Promise<string> {
    const llm = loadSettings().llm;
    const prompt = `Given these content pieces and KB snippets, write 2–3 short bullet insights about what's working. No hype. Reference specific hooks. Max 120 words. Plain bullets only.

Content: ${JSON.stringify(pieces.slice(0, 5))}
KB: ${passages
      .slice(0, 3)
      .map((p) => p.content)
      .join("\n")}`;
    try {
      return await completeWithSettings(llm, prompt);
    } catch {
      const fallback =
        passages.find((p) => p.scope === "experiment_history") ?? passages[0];
      if (fallback) {
        return `• ${fallback.content}`;
      }
      throw new Error("Could not generate analysis — configure LLM in Settings.");
    }
  },

  subscribe(listener: () => void): () => void {
    if (useLive()) return subscribeLiveStatus(listener);
    return demoStore.subscribe(listener);
  },
};
