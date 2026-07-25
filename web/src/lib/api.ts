import { demoStore } from "./demo-store";
import { getApiBaseUrl, isDemoWorkspace, loadSettings } from "./settings";
import type {
  ApprovalCheckpointStage,
  CheckpointRecord,
  ExperimentCard,
  OperatingMode,
  RAGPassage,
  SocialPlatform,
  StageRecord,
  WorkflowStage,
  WorkflowStatus,
} from "./types";
import { CHECKPOINT_STAGES, WORKFLOW_STAGES } from "./types";

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

  async search(query: string): Promise<RAGPassage[]> {
    if (useLive()) {
      const raw = await liveFetch<unknown>("/api/content-creator-ai/search", {
        method: "POST",
        body: JSON.stringify({ query, limit: 10 }),
      });
      return mapPassages(raw);
    }
    await new Promise((r) => setTimeout(r, 350));
    return demoStore.search(query);
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

  subscribe(listener: () => void): () => void {
    if (useLive()) return subscribeLiveStatus(listener);
    return demoStore.subscribe(listener);
  },
};
