import type { LLMSettings } from "./settings";

export interface LLMTestResult {
  ok: boolean;
  message: string;
  sample?: string;
  models?: string[];
}

/** Local models are slow when cold; cloud stays shorter. */
const OLLAMA_TIMEOUT_MS = 180_000;
const CLOUD_TIMEOUT_MS = 60_000;

function trimBase(url: string): string {
  return url.replace(/\/$/, "");
}

function timeoutMsFor(provider: LLMSettings["provider"]): number {
  return provider === "ollama" || provider === "openai_compatible"
    ? OLLAMA_TIMEOUT_MS
    : CLOUD_TIMEOUT_MS;
}

function friendlyFetchError(e: unknown, provider: string): Error {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof DOMException && e.name === "TimeoutError") {
    return new Error(
      `${provider} timed out — local models can take 1–3 minutes when cold. Keep Ollama open, retry, or set a Claude fallback in Settings.`,
    );
  }
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return new Error(
      `${message} — cannot reach ${provider}. Is Ollama running on the Base URL? Browsers also block some cloud APIs with CORS.`,
    );
  }
  return e instanceof Error ? e : new Error(message);
}

/** List local Ollama models via /api/tags. */
export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${trimBase(baseUrl)}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Ollama tags failed (${res.status})`);
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return (data.models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => Boolean(n));
}

/** Chat models only — hide embedders from the Settings dropdown. */
export function filterChatModels(models: string[]): string[] {
  return models.filter((name) => {
    const n = name.toLowerCase();
    return !n.includes("embed") && !n.includes("nomic-embed");
  });
}

async function completeOllama(
  settings: LLMSettings,
  prompt: string,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${trimBase(settings.baseUrl)}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        prompt,
        stream: false,
        // Keep the runner warm between Plan/Chat turns.
        keep_alive: "30m",
        options: {
          temperature: settings.temperature,
          // Ollama 0.32 defaults to a huge context (~32k) which makes every
          // load/reload feel slow. 4k is enough for our RAG-bounded prompts.
          num_ctx: 4096,
        },
      }),
      signal: AbortSignal.timeout(timeoutMsFor("ollama")),
    });
  } catch (e) {
    throw friendlyFetchError(e, "Ollama");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404) {
      throw new Error(
        `Ollama model "${settings.model}" not found (404). Pull it with \`ollama pull ${settings.model}\` or pick an installed model in Settings.`,
      );
    }
    throw new Error(
      `Ollama generate failed (${res.status})${body ? `: ${body.slice(0, 160)}` : ""}`,
    );
  }
  const data = (await res.json()) as { response?: string };
  if (!data.response) throw new Error("Ollama returned an empty response");
  return data.response;
}

async function completeOpenAICompatible(
  settings: LLMSettings,
  prompt: string,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  let res: Response;
  try {
    res = await fetch(`${trimBase(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        messages: [
          {
            role: "system",
            content: "You are a concise assistant for Liquid Copy.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMsFor(settings.provider)),
    });
  } catch (e) {
    throw friendlyFetchError(e, settings.provider);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `OpenAI-compatible error (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Provider returned an empty completion");
  return text;
}

async function completeAnthropic(
  settings: LLMSettings,
  prompt: string,
): Promise<string> {
  if (!settings.apiKey.trim()) throw new Error("Anthropic API key is required");

  let res: Response;
  try {
    res = await fetch(`${trimBase(settings.baseUrl)}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        // Browser calls need this for Anthropic CORS (may still be blocked by Anthropic).
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 1024,
        temperature: settings.temperature,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
    });
  } catch (e) {
    throw friendlyFetchError(e, "Anthropic");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic error (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned an empty completion");
  return text;
}

function canUseClaudeFallback(settings: LLMSettings): boolean {
  return (
    (settings.provider === "ollama" ||
      settings.provider === "openai_compatible") &&
    Boolean(settings.fallbackApiKey.trim())
  );
}

async function completePrimary(
  settings: LLMSettings,
  prompt: string,
): Promise<string> {
  if (settings.provider === "ollama") return completeOllama(settings, prompt);
  if (settings.provider === "anthropic") {
    return completeAnthropic(settings, prompt);
  }
  return completeOpenAICompatible(settings, prompt);
}

async function completeViaClaudeFallback(
  settings: LLMSettings,
  prompt: string,
): Promise<string> {
  return completeAnthropic(
    {
      ...settings,
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: settings.fallbackApiKey,
      model: settings.fallbackModel || "claude-sonnet-4-6",
    },
    prompt,
  );
}

export async function testLLMConnection(
  settings: LLMSettings,
): Promise<LLMTestResult> {
  const prompt =
    'Reply with exactly this JSON and nothing else: {"ok":true,"product":"Liquid Copy"}';

  try {
    let models: string[] | undefined;
    if (settings.provider === "ollama") {
      try {
        models = filterChatModels(await listOllamaModels(settings.baseUrl));
      } catch {
        models = undefined;
      }
    }

    let sample: string;
    let via = settings.provider;
    try {
      sample = await completePrimary(settings, prompt);
    } catch (primaryError) {
      if (!canUseClaudeFallback(settings)) throw primaryError;
      sample = await completeViaClaudeFallback(settings, prompt);
      via = "anthropic";
    }

    return {
      ok: true,
      message:
        via === settings.provider
          ? `Connected via ${settings.provider} · model ${settings.model}`
          : `Primary ${settings.provider} failed — connected via Claude fallback · ${settings.fallbackModel}`,
      sample: sample.trim().slice(0, 400),
      models,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
}

/**
 * Complete a prompt with Settings LLM.
 * Local providers fall back to Claude when a fallback key is configured.
 */
export async function completeWithSettings(
  settings: LLMSettings,
  prompt: string,
): Promise<string> {
  try {
    return await completePrimary(settings, prompt);
  } catch (primaryError) {
    if (!canUseClaudeFallback(settings)) throw primaryError;
    try {
      return await completeViaClaudeFallback(settings, prompt);
    } catch {
      throw primaryError;
    }
  }
}
