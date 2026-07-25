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
  activeClient = process.env.LLM_BASE_URL
    ? new OllamaLLMClient()
    : new UnavailableLLMClient();
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
