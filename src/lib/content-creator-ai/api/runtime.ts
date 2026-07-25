/**
 * Process-wide runtime shared by the API routes (supports Tasks 10.1, 10.2).
 *
 * Route handlers stay thin wrappers over this module so the same logic can be
 * driven directly from tests without standing up an HTTP server.
 */
import type { SocialPlatform, RetrievalScope } from "../types/enums.js";
import type { RAGPassage } from "../types/index.js";
import { semanticSearch } from "../rag/vectorstore.js";
import { readKBEntity, writeKBEntity } from "../kb/storage.js";
import { parseFromMarkdown } from "../kb/markdown.js";
import { CheckpointManager } from "../orchestration/checkpoints.js";
import { WorkflowEngine } from "../orchestration/workflow-engine.js";
import { ContextAgent } from "../agents/context-agent/index.js";
import { AudienceAgent } from "../agents/audience-agent/index.js";
import { FirecrawlAdapter } from "../integrations/firecrawl.js";
import {
  getLLMClient,
  resetLLMClient,
  setLLMClient,
  OllamaLLMClient,
  OpenAICompatibleLLMClient,
} from "../integrations/llm.js";
import { traceability, type TraceabilityBuilder } from "./traceability.js";
import { SUPPORTED_PLATFORMS } from "../agents/strategy-agent/goal-validation.js";

/** Requirement 14.5 — manual knowledge search returns up to 10 results. */
export const MAX_SEARCH_RESULTS = 10;

export interface Runtime {
  checkpoints: CheckpointManager;
  workflow: WorkflowEngine;
  contextAgent: ContextAgent;
  audienceAgent: AudienceAgent;
  traceability: TraceabilityBuilder;
}

let runtime: Runtime | null = null;

function buildContextAgent(): ContextAgent {
  return new ContextAgent({
    firecrawl: new FirecrawlAdapter({
      apiKey: process.env.FIRECRAWL_API_KEY,
    }),
    llm: getLLMClient(),
  });
}

export function getRuntime(): Runtime {
  if (runtime) return runtime;
  const checkpoints = new CheckpointManager();
  runtime = {
    checkpoints,
    workflow: new WorkflowEngine({ checkpoints }),
    contextAgent: buildContextAgent(),
    audienceAgent: new AudienceAgent(),
    traceability,
  };
  return runtime;
}

/** Replace the runtime (tests). */
export function setRuntime(next: Runtime | null): void {
  runtime?.checkpoints.dispose();
  runtime = next;
}

/** Rebuild a fresh runtime (tests). */
export function resetRuntime(): Runtime {
  runtime?.checkpoints.dispose();
  runtime = null;
  return getRuntime();
}

/** Rebuild ContextAgent after Firecrawl / LLM env changes. */
export function refreshContextAgent(): void {
  const rt = getRuntime();
  rt.contextAgent = buildContextAgent();
}

export interface RuntimeConfigInput {
  firecrawlApiKey?: string;
  llm?: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    temperature?: number;
  };
}

/**
 * Apply secrets from the operator UI (or request headers) into process env and
 * refresh clients so the next ingest/search uses them.
 */
export function applyRuntimeConfig(input: RuntimeConfigInput): string[] {
  const applied: string[] = [];

  if (typeof input.firecrawlApiKey === "string" && input.firecrawlApiKey.trim()) {
    process.env.FIRECRAWL_API_KEY = input.firecrawlApiKey.trim();
    applied.push("firecrawlApiKey");
  }

  const llm = input.llm;
  if (llm) {
    if (llm.provider) {
      process.env.LLM_PROVIDER = llm.provider;
      applied.push("llm.provider");
    }
    if (llm.baseUrl?.trim()) {
      process.env.LLM_BASE_URL = llm.baseUrl.trim().replace(/\/$/, "");
      applied.push("llm.baseUrl");
    }
    if (llm.model?.trim()) {
      process.env.LLM_MODEL = llm.model.trim();
      applied.push("llm.model");
    }
    if (typeof llm.apiKey === "string") {
      process.env.LLM_API_KEY = llm.apiKey;
      applied.push("llm.apiKey");
    }
    if (typeof llm.temperature === "number") {
      process.env.LLM_TEMPERATURE = String(llm.temperature);
      applied.push("llm.temperature");
    }

    resetLLMClient();
    const provider = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
    if (provider === "ollama") {
      setLLMClient(
        new OllamaLLMClient(
          fetch,
          process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434",
          process.env.LLM_MODEL ?? "llama3.1",
        ),
      );
    } else if (
      provider === "openai" ||
      provider === "openai_compatible" ||
      provider === "anthropic"
    ) {
      // Anthropic via OpenAI-compatible proxies is common locally; raw Anthropic
      // Messages API is not required for the hackathon heuristic fallback path.
      setLLMClient(
        new OpenAICompatibleLLMClient({
          baseUrl:
            process.env.LLM_BASE_URL ??
            (provider === "openai"
              ? "https://api.openai.com/v1"
              : "http://127.0.0.1:1234/v1"),
          model: process.env.LLM_MODEL ?? "gpt-4o-mini",
          apiKey: process.env.LLM_API_KEY ?? "",
        }),
      );
    } else if (process.env.LLM_BASE_URL) {
      setLLMClient(new OllamaLLMClient());
    }
  }

  if (applied.length > 0) refreshContextAgent();
  return applied;
}

/** Pull secrets from request headers on each call (local API server). */
export function applyRequestSecrets(headers: Headers): void {
  const firecrawl =
    headers.get("x-firecrawl-api-key") ?? headers.get("X-Firecrawl-Api-Key");
  const baseUrl =
    headers.get("x-llm-base-url") ?? headers.get("X-LLM-Base-Url");
  const model = headers.get("x-llm-model") ?? headers.get("X-LLM-Model");
  const apiKey = headers.get("x-llm-api-key") ?? headers.get("X-LLM-Api-Key");
  const provider =
    headers.get("x-llm-provider") ?? headers.get("X-LLM-Provider");

  if (!firecrawl && !baseUrl && !model && !apiKey && !provider) return;

  applyRuntimeConfig({
    firecrawlApiKey: firecrawl ?? undefined,
    llm:
      baseUrl || model || apiKey || provider
        ? {
            provider: provider ?? undefined,
            baseUrl: baseUrl ?? undefined,
            model: model ?? undefined,
            apiKey: apiKey ?? undefined,
          }
        : undefined,
  });
}

// ---- Manual knowledge search (Requirement 14.5) ----

export interface SearchRequest {
  query: string;
  scope?: RetrievalScope;
  limit?: number;
}

export interface SearchResponse {
  results: RAGPassage[];
  count: number;
  durationMs: number;
  /** True when the index was empty or unavailable. */
  empty: boolean;
}

/**
 * Natural-language knowledge search, capped at 10 results. Never throws — an
 * unavailable index yields zero results, per the RAG layer contract.
 */
export async function searchKnowledge(
  request: SearchRequest,
): Promise<SearchResponse> {
  const startedAt = Date.now();
  const limit = Math.min(
    MAX_SEARCH_RESULTS,
    Math.max(1, request.limit ?? MAX_SEARCH_RESULTS),
  );
  const results = await semanticSearch({
    query: request.query,
    scope: request.scope,
    k: limit,
  });
  return {
    results: results.slice(0, limit),
    count: Math.min(results.length, limit),
    durationMs: Date.now() - startedAt,
    empty: results.length === 0,
  };
}

// ---- Knowledge base read/write ----

export interface KBReadResponse {
  entityId: string;
  found: boolean;
  markdown?: string;
  parsed?: ReturnType<typeof parseFromMarkdown>["payload"];
}

export async function readKnowledgeBase(
  entityId: string,
): Promise<KBReadResponse> {
  const markdown = await readKBEntity(entityId);
  if (!markdown) return { entityId, found: false };
  return {
    entityId,
    found: true,
    markdown,
    parsed: parseFromMarkdown(markdown).payload,
  };
}

export interface KBWriteRequest {
  entityId: string;
  entityType: "company_identity" | "product" | "audience" | "experiment";
  markdown?: string;
  payload?: Parameters<typeof writeKBEntity>[0]["content"];
  modifiedFields?: string[];
  priorValues?: Record<string, unknown>;
}

export async function updateKnowledgeBase(request: KBWriteRequest): Promise<{
  kbVersion: string;
  versionNumber: number;
  snapshotPath: string;
}> {
  const content = request.markdown ?? request.payload;
  if (content === undefined) {
    throw new Error("Either markdown or payload is required");
  }
  const result = await writeKBEntity({
    entityId: request.entityId,
    entityType: request.entityType,
    content,
    author: "user",
    modifiedFields: request.modifiedFields,
    priorValues: request.priorValues,
  });
  return {
    kbVersion: result.version.versionId,
    versionNumber: result.version.versionNumber,
    snapshotPath: result.snapshotPath,
  };
}

// ---- Platform selection (Requirements 5.1, 5.2, 5.4) ----

export interface PlatformSelectionResult {
  ok: boolean;
  selected: SocialPlatform[];
  invalid: string[];
  /** Requirement 5.4 message when the selection is empty. */
  message?: string;
}

/**
 * Replace the active publishing targets. An empty selection is stored but
 * reported as not-ok, since content generation is blocked until one is chosen.
 */
export function updatePlatformSelection(
  platforms: unknown,
): PlatformSelectionResult {
  const requested = Array.isArray(platforms) ? platforms : [];
  const selected: SocialPlatform[] = [];
  const invalid: string[] = [];

  for (const candidate of requested) {
    if (
      typeof candidate === "string" &&
      (SUPPORTED_PLATFORMS as readonly string[]).includes(candidate)
    ) {
      if (!selected.includes(candidate as SocialPlatform)) {
        selected.push(candidate as SocialPlatform);
      }
    } else {
      invalid.push(String(candidate));
    }
  }

  // Requirement 5.2 — replace the previous selection with the updated set.
  getRuntime().workflow.setSelectedPlatforms(selected);

  if (selected.length === 0) {
    return {
      ok: false,
      selected,
      invalid,
      message: "At least one platform must be selected before content generation.",
    };
  }
  return { ok: true, selected, invalid };
}

// ---- Workflow status ----

export interface WorkflowStatusResponse {
  mode: string;
  currentStage: string | null;
  complete: boolean;
  stages: ReturnType<WorkflowEngine["listRecords"]>;
  checkpoints: ReturnType<CheckpointManager["listStates"]>;
  selectedPlatforms: SocialPlatform[];
}

export function workflowStatus(): WorkflowStatusResponse {
  const { workflow, checkpoints } = getRuntime();
  return {
    mode: workflow.getMode(),
    currentStage: workflow.currentStage(),
    complete: workflow.isComplete(),
    stages: workflow.listRecords(),
    checkpoints: checkpoints.listStates(),
    selectedPlatforms: workflow.getSelectedPlatforms(),
  };
}

// ---- JSON helpers for the route handlers ----

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/** Parse a JSON body, returning null rather than throwing on malformed input. */
export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
