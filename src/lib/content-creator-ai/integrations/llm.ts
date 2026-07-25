/**
 * Local LLM client (Ollama-compatible endpoint via `LLM_BASE_URL`).
 *
 * Contract: `complete` NEVER throws and NEVER returns a partial failure as a
 * string — it resolves to `null` when the model is unreachable, times out, or
 * exhausts its retries. Callers fall back to deterministic heuristics, mirroring
 * the RAG layer's "return [] rather than error" contract.
 *
 * Design: "Local LLM | Inference timeout | Retry up to 3 times with exponential
 * backoff; fall back to error notification".
 */

export interface LLMCompletionOptions {
  system?: string;
  temperature?: number;
  /** Per-attempt timeout. Default 30s. */
  timeoutMs?: number;
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
}

export interface LLMClient {
  complete(
    prompt: string,
    options?: LLMCompletionOptions,
  ): Promise<string | null>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
/** Backoff before attempt n (1-indexed): attempt 2 waits 250ms, attempt 3 waits 500ms. */
const BASE_BACKOFF_MS = 250;

export function resolveLLMBaseUrl(): string {
  return (
    process.env.LLM_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:11434"
  );
}

export function resolveLLMModel(): string {
  return process.env.LLM_MODEL ?? "llama3.1";
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Never hold the event loop open purely for a backoff delay.
    (t as unknown as { unref?: () => void }).unref?.();
  });

/**
 * Ollama `/api/generate` client with bounded retries and exponential backoff.
 */
export class OllamaLLMClient implements LLMClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl: string = resolveLLMBaseUrl(),
    private readonly model: string = resolveLLMModel(),
  ) {}

  async complete(
    prompt: string,
    options: LLMCompletionOptions = {},
  ): Promise<string | null> {
    const attempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 2));
      const text = await this.attempt(prompt, options, timeoutMs);
      if (text !== null) return text;
    }
    return null;
  }

  private async attempt(
    prompt: string,
    options: LLMCompletionOptions,
    timeoutMs: number,
  ): Promise<string | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          system: options.system,
          stream: false,
          options:
            options.temperature === undefined
              ? undefined
              : { temperature: options.temperature },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { response?: unknown };
      return typeof data.response === "string" ? data.response : null;
    } catch {
      return null;
    }
  }
}

/** OpenAI-compatible chat completions (OpenAI, LM Studio, vLLM, …). */
export class OpenAICompatibleLLMClient implements LLMClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      apiKey?: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async complete(
    prompt: string,
    options: LLMCompletionOptions = {},
  ): Promise<string | null> {
    const attempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const root = this.options.baseUrl.replace(/\/$/, "");

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 2));
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (this.options.apiKey) {
          headers.Authorization = `Bearer ${this.options.apiKey}`;
        }
        const messages: Array<{ role: string; content: string }> = [];
        if (options.system) {
          messages.push({ role: "system", content: options.system });
        }
        messages.push({ role: "user", content: prompt });
        const res = await fetchImpl(`${root}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: this.options.model,
            messages,
            temperature: options.temperature,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = data.choices?.[0]?.message?.content;
        if (typeof text === "string") return text;
      } catch {
        // retry
      }
    }
    return null;
  }
}

/** Anthropic Messages API (`/v1/messages`). */
export class AnthropicLLMClient implements LLMClient {
  constructor(
    private readonly options: {
      apiKey: string;
      model?: string;
      baseUrl?: string;
      fetchImpl?: typeof fetch;
      maxTokens?: number;
    },
  ) {}

  async complete(
    prompt: string,
    options: LLMCompletionOptions = {},
  ): Promise<string | null> {
    if (!this.options.apiKey.trim()) return null;

    const attempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const root = (
      this.options.baseUrl ?? "https://api.anthropic.com"
    ).replace(/\/$/, "");
    const model = this.options.model ?? "claude-sonnet-4-20250514";

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 2));
      try {
        const body: Record<string, unknown> = {
          model,
          max_tokens: this.options.maxTokens ?? 1024,
          messages: [{ role: "user", content: prompt }],
        };
        if (options.system) body.system = options.system;
        if (options.temperature !== undefined) {
          body.temperature = options.temperature;
        }

        const res = await fetchImpl(`${root}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.options.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        const text = data.content?.find((c) => c.type === "text")?.text;
        if (typeof text === "string" && text.length > 0) return text;
      } catch {
        // retry
      }
    }
    return null;
  }
}

/**
 * Prefer a fast local primary (Ollama); if it times out / fails, use Claude.
 */
export class FallbackLLMClient implements LLMClient {
  constructor(
    private readonly primary: LLMClient,
    private readonly fallback: LLMClient,
    private readonly primaryTimeoutMs = 8_000,
  ) {}

  async complete(
    prompt: string,
    options: LLMCompletionOptions = {},
  ): Promise<string | null> {
    const primary = await this.primary.complete(prompt, {
      ...options,
      timeoutMs: Math.min(
        options.timeoutMs ?? this.primaryTimeoutMs,
        this.primaryTimeoutMs,
      ),
      maxAttempts: Math.min(options.maxAttempts ?? 1, 1),
    });
    if (primary !== null) return primary;
    return this.fallback.complete(prompt, options);
  }
}

export interface BuildLLMClientConfig {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** Claude key used when primary is Ollama (or any local path). */
  fallbackApiKey?: string;
  fallbackModel?: string;
}

/** Build the process LLM client from Settings / env-shaped config. */
export function buildLLMClientFromConfig(
  cfg: BuildLLMClientConfig = {},
): LLMClient {
  const provider = (cfg.provider ?? process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
  const baseUrl = (
    cfg.baseUrl ??
    process.env.LLM_BASE_URL ??
    "http://127.0.0.1:11434"
  ).replace(/\/$/, "");
  const model = cfg.model ?? process.env.LLM_MODEL ?? "llama3.1";
  const apiKey = cfg.apiKey ?? process.env.LLM_API_KEY ?? "";
  const fallbackApiKey =
    cfg.fallbackApiKey ?? process.env.LLM_FALLBACK_API_KEY ?? "";
  const fallbackModel =
    cfg.fallbackModel ??
    process.env.LLM_FALLBACK_MODEL ??
    "claude-sonnet-4-20250514";

  let primary: LLMClient;
  if (provider === "anthropic") {
    primary = new AnthropicLLMClient({
      apiKey: apiKey || fallbackApiKey,
      model: model || fallbackModel,
      baseUrl: baseUrl.includes("anthropic")
        ? baseUrl
        : "https://api.anthropic.com",
    });
  } else if (provider === "openai" || provider === "openai_compatible") {
    primary = new OpenAICompatibleLLMClient({
      baseUrl:
        baseUrl ||
        (provider === "openai"
          ? "https://api.openai.com/v1"
          : "http://127.0.0.1:1234/v1"),
      model: model || "gpt-4o-mini",
      apiKey,
    });
  } else if (provider === "ollama" || process.env.LLM_BASE_URL || cfg.baseUrl) {
    primary = new OllamaLLMClient(fetch, baseUrl, model);
  } else {
    primary = new UnavailableLLMClient();
  }

  // Ollama (or local) → Claude if a fallback key is configured.
  if (
    fallbackApiKey.trim() &&
    (provider === "ollama" || provider === "openai_compatible")
  ) {
    return new FallbackLLMClient(
      primary,
      new AnthropicLLMClient({
        apiKey: fallbackApiKey.trim(),
        model: fallbackModel,
        baseUrl: "https://api.anthropic.com",
      }),
      8_000,
    );
  }

  return primary;
}

/**
 * Always-unavailable client. The default in test environments so that agent
 * logic exercises its deterministic heuristic path instead of reaching out to
 * a model that may or may not be running.
 */
export class UnavailableLLMClient implements LLMClient {
  async complete(): Promise<string | null> {
    return null;
  }
}

/** Scripted client for tests: returns queued responses in order. */
export class ScriptedLLMClient implements LLMClient {
  readonly prompts: string[] = [];
  constructor(private readonly responses: Array<string | null>) {}

  async complete(prompt: string): Promise<string | null> {
    this.prompts.push(prompt);
    const next = this.responses.shift();
    return next ?? null;
  }
}

let activeClient: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (activeClient) return activeClient;
  // Opt in explicitly: an unset LLM_BASE_URL must not cause every agent call to
  // wait on connection failures to localhost during tests.
  if (process.env.LLM_BASE_URL || process.env.LLM_PROVIDER || process.env.LLM_FALLBACK_API_KEY) {
    activeClient = buildLLMClientFromConfig();
  } else {
    activeClient = new UnavailableLLMClient();
  }
  return activeClient;
}

export function setLLMClient(client: LLMClient | null): void {
  activeClient = client;
}

export function resetLLMClient(): void {
  activeClient = null;
}

/**
 * Parse a JSON object out of a model response, tolerating ```json fences and
 * surrounding prose. Returns null when nothing parseable is present.
 */
export function parseJSONFromLLM<T>(raw: string | null): T | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], raw].filter(
    (c): c is string => typeof c === "string",
  );
  for (const candidate of candidates) {
    const start = candidate.search(/[[{]/);
    if (start === -1) continue;
    const opener = candidate[start];
    const closer = opener === "{" ? "}" : "]";
    const end = candidate.lastIndexOf(closer);
    if (end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      continue;
    }
  }
  return null;
}
