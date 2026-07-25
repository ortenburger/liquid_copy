import type { LLMSettings } from "./settings";

export interface LLMTestResult {
  ok: boolean;
  message: string;
  sample?: string;
  models?: string[];
}

function trimBase(url: string): string {
  return url.replace(/\/$/, "");
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

async function completeOllama(settings: LLMSettings, prompt: string): Promise<string> {
  const res = await fetch(`${trimBase(settings.baseUrl)}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      prompt,
      stream: false,
      options: { temperature: settings.temperature },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Ollama generate failed (${res.status})`);
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

  const res = await fetch(`${trimBase(settings.baseUrl)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.model,
      temperature: settings.temperature,
      messages: [
        { role: "system", content: "You are a concise assistant for Liquid Copy." },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI-compatible error (${res.status}): ${body.slice(0, 200)}`);
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

  const res = await fetch(`${trimBase(settings.baseUrl)}/v1/messages`, {
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
      max_tokens: 256,
      temperature: settings.temperature,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
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

export async function testLLMConnection(
  settings: LLMSettings,
): Promise<LLMTestResult> {
  const prompt =
    'Reply with exactly this JSON and nothing else: {"ok":true,"product":"Liquid Copy"}';

  try {
    let models: string[] | undefined;
    if (settings.provider === "ollama") {
      try {
        models = await listOllamaModels(settings.baseUrl);
      } catch {
        models = undefined;
      }
    }

    let sample: string;
    if (settings.provider === "ollama") {
      sample = await completeOllama(settings, prompt);
    } else if (settings.provider === "anthropic") {
      sample = await completeAnthropic(settings, prompt);
    } else {
      sample = await completeOpenAICompatible(settings, prompt);
    }

    return {
      ok: true,
      message: `Connected via ${settings.provider} · model ${settings.model}`,
      sample: sample.trim().slice(0, 400),
      models,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message:
        message.includes("Failed to fetch") || message.includes("NetworkError")
          ? `${message} — browsers block some cloud APIs with CORS. Prefer Ollama locally, or put a small proxy in front of Claude/OpenAI.`
          : message,
    };
  }
}

export async function completeWithSettings(
  settings: LLMSettings,
  prompt: string,
): Promise<string> {
  if (settings.provider === "ollama") return completeOllama(settings, prompt);
  if (settings.provider === "anthropic") return completeAnthropic(settings, prompt);
  return completeOpenAICompatible(settings, prompt);
}
