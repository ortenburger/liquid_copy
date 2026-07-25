import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";
import type { LLMSettings } from "../settings";

function trimBase(url: string): string {
  return url.replace(/\/$/, "");
}

/** Keep local Ollama snappy — huge default context (~32k) makes loads slow. */
export const OLLAMA_NUM_CTX = 4096;

export function ollamaProviderOptions(settings: LLMSettings) {
  if (settings.provider !== "ollama") return undefined;
  return {
    ollama: {
      options: { num_ctx: OLLAMA_NUM_CTX },
    },
  };
}

/** Build an AI SDK language model from Liquid Copy Settings. */
export function createModelFromSettings(settings: LLMSettings): LanguageModel {
  const baseUrl = trimBase(settings.baseUrl);
  const modelId = settings.model.trim() || "llama3.1";

  if (settings.provider === "ollama") {
    const ollamaBase = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
    const ollama = createOllama({
      baseURL: ollamaBase,
      compatibility: "strict",
    });
    return ollama(modelId);
  }

  if (settings.provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: settings.apiKey,
      baseURL: baseUrl.includes("/v1") ? baseUrl : `${baseUrl}/v1`,
      headers: {
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
    return anthropic(modelId);
  }

  // openai + openai_compatible (LM Studio, vLLM, Ollama /v1, …)
  const openai = createOpenAI({
    apiKey: settings.apiKey || "not-needed",
    baseURL: baseUrl,
    name: settings.provider,
  });
  return openai(modelId);
}
