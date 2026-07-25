import { demoStore } from "./demo-store";
import { completeWithSettings } from "./llm-browser";
import { getApiBaseUrl, isDemoWorkspace, loadSettings } from "./settings";
import { PLAN_CHECKPOINT_STAGES } from "./simple-ui-nav";
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
  RAGPassage,
  RetrievalScope,
  RoadmapSummary,
  SocialPlatform,
  StageRecord,
  WorkflowStage,
  WorkflowStatus,
} from "./types";
import { CHECKPOINT_STAGES, WORKFLOW_STAGES } from "./types";

export interface RagMarkdownSource {
  entityId: string;
  entityType?: string;
  markdown: string;
}

export interface RagAskResult {
  answer: string;
  passages: RAGPassage[];
  markdownSources: RagMarkdownSource[];
  model: string;
  provider: string;
  usedRagContext: boolean;
}

export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  at: string;
}

export interface AgentToolEvent {
  name: string;
  input?: string;
  output: string;
}

export interface AgentChatResult {
  reply: string;
  passages: RAGPassage[];
  markdownSources: RagMarkdownSource[];
  tools: AgentToolEvent[];
  model: string;
  provider: string;
}

const SCOPE_TO_ENTITY_TYPE: Record<RetrievalScope, KBEntitySummary["entityType"]> =
  {
    company_memory: "company_identity",
    product_context: "product",
    audience_learning: "audience",
    experiment_history: "experiment",
  };

const MAX_MD_CHARS = 10_000;

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
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
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
    ) as Partial<StageRecord> | undefined;
    return {
      stage,
      status: (found?.status as StageRecord["status"]) ?? "pending",
      approvedByUser: Boolean(found?.approvedByUser),
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
      const result = await liveFetch<{ status: Record<string, unknown> }>(
        "/api/content-creator-ai/workflow/run",
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
      case "kickstart_plan": {
        await this.kickstartPlan();
        return {
          name,
          output:
            "Plan kickstarted. Roadmap/hypotheses are ready — ask Chat to review or approve.",
        };
      }
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
      default:
        return { name, input: arg, output: `Unknown tool: ${name}` };
    }
  },

  /**
   * Main agent chat: RAG + markdown context, optional tools, then Ollama reply.
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

    const tools: AgentToolEvent[] = [];
    const lower = lastUser.toLowerCase();
    const toolPlan: Array<{ name: string; input?: string }> = [];

    if (/\b(kickstart|generate plan|regenerate plan)\b/.test(lower)) {
      toolPlan.push({ name: "kickstart_plan" });
    }
    if (/\b(list (kb|entities|docs|documents)|what(?:'s| is) in the (kb|knowledge))\b/.test(lower)) {
      toolPlan.push({ name: "list_kb" });
    }
    if (/\b(testing plan|hypothes|roadmap)\b/.test(lower)) {
      toolPlan.push({ name: "get_testing_plan" });
    }
    if (/\b(pending approval|approvals? waiting|what needs approval)\b/.test(lower)) {
      toolPlan.push({ name: "list_pending_approvals" });
    }
    if (/\bapprove roadmap\b/.test(lower)) {
      toolPlan.push({ name: "approve_checkpoint", input: "RoadmapReview" });
    }
    if (/\bapprove hypothes/.test(lower)) {
      toolPlan.push({ name: "approve_checkpoint", input: "HypothesisReview" });
    }
    if (/\bapprove content\b/.test(lower)) {
      toolPlan.push({ name: "approve_checkpoint", input: "ContentReview" });
    }
    if (
      /\b(analytics|metrics|engagement|winner|winning|performance|how (?:are|is) (?:we|experiments?) (?:doing|performing))\b/.test(
        lower,
      )
    ) {
      toolPlan.push({ name: "get_analytics" });
      // Prefer experiment history when talking performance.
      if (!options?.scope) {
        const enriched = await this.gatherRagMarkdownContext(lastUser, {
          scope: "experiment_history",
          limit: 4,
        });
        for (const p of enriched.passages) {
          if (!passages.some((x) => x.content === p.content)) passages.push(p);
        }
        for (const m of enriched.markdownSources) {
          if (!markdownSources.some((x) => x.entityId === m.entityId)) {
            markdownSources.push(m);
          }
        }
      }
    }
    const readMatch = lastUser.match(
      /\b(?:read|open|show)\s+([a-z0-9._-]+?)(?:\.md)?\b/i,
    );
    if (readMatch && !/\banalytics\b/.test(lower)) {
      toolPlan.push({ name: "read_markdown", input: readMatch[1] });
    }

    // Deduplicate tools
    const seen = new Set<string>();
    for (const t of toolPlan) {
      const key = `${t.name}:${t.input ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tools.push(await this.runAgentTool(t.name, t.input));
    }

    const passageBlock =
      passages.length === 0
        ? "(none)"
        : passages
            .map(
              (p, i) =>
                `[${i + 1}] ${p.scope} · ${p.sourceDoc} (${(p.similarityScore * 100).toFixed(0)}%)\n${p.content}`,
            )
            .join("\n\n");

    const markdownBlock =
      markdownSources.length === 0
        ? "(none)"
        : markdownSources
            .map(
              (m) =>
                `--- FILE: ${m.entityId}.md (${m.entityType ?? "unknown"}) ---\n${m.markdown}`,
            )
            .join("\n\n");

    const toolBlock =
      tools.length === 0
        ? "(no tools run)"
        : tools
            .map(
              (t) =>
                `TOOL ${t.name}${t.input ? ` ${t.input}` : ""}\n${t.output}`,
            )
            .join("\n\n");

    const prior = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    const prompt = `You are the Liquid Copy agent. The main UI is this chat. Use RAG passages, KB markdown files, and tool results as ground truth. Be concise and actionable. No hype.

Available tools (already executed when relevant; you may suggest the user ask for them):
- list_kb
- read_markdown <entityId>
- search_rag <query>
- kickstart_plan
- get_testing_plan
- list_pending_approvals
- approve_checkpoint <StageName>
- get_analytics (experiment metrics / winners)

Conversation:
${prior || `USER: ${lastUser}`}

RAG passages:
${passageBlock}

KB markdown files:
${markdownBlock}

Tool results:
${toolBlock}

Respond to the latest user message. If tools already ran, incorporate their results.`;

    const reply = await completeWithSettings(llm, prompt);
    return {
      reply: reply.trim(),
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
    });

    // URL scrapes return a review draft — auto-commit so Knowledge search works.
    if (drafted.draftId && drafted.status !== "firecrawl_error") {
      return liveFetch("/api/content-creator-ai/ingest", {
        method: "POST",
        body: JSON.stringify({ action: "accept", draftId: drafted.draftId }),
      });
    }
    return drafted;
  },

  async listExperiments(): Promise<ExperimentCard[]> {
    if (useLive()) return [];
    return demoStore.listExperiments();
  },

  /**
   * Kickstart plan generation for Simple UI.
   * Simulation: reset demo roadmap + hypotheses to waiting.
   * Real: run the workflow pipeline (context → roadmap → hypotheses).
   */
  async kickstartPlan(): Promise<WorkflowStatus> {
    if (useLive()) {
      await this.syncConfig();
      return this.runWorkflow();
    }
    return demoStore.kickstartPlan();
  },

  async getTestingPlan(): Promise<{
    roadmap: RoadmapSummary | null;
    roadmapText: string | null;
    hypotheses: HypothesisCard[];
  }> {
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
    let roadmap: RoadmapSummary | null = null;
    let roadmapText: string | null = roadmapCp?.pendingOutput ?? null;
    if (roadmapCp?.pendingOutput) {
      try {
        const parsed = JSON.parse(roadmapCp.pendingOutput) as RoadmapSummary;
        if (parsed && Array.isArray(parsed.weeks)) {
          roadmap = parsed;
          roadmapText = null;
        }
      } catch {
        /* keep raw text */
      }
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

    const rows: AnalyticsRow[] = experiments.map((e) => ({
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
    }));

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

    const winner = rows.find((r) => r.winner) ?? rows[0];
    return {
      rows,
      winnerId: winner?.id,
      inconclusive: rows.every((r) => r.impressions === 0),
      summary:
        passages[0]?.content.slice(0, 280) ??
        (rows.length
          ? `${rows.length} experiment rows loaded. Configure Zernio for live metrics.`
          : "No analytics yet — publish experiments and connect Zernio."),
      updatedAt: new Date().toISOString(),
    };
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
