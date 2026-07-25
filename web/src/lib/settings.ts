export type LLMProvider =
  | "ollama"
  | "openai"
  | "anthropic"
  | "openai_compatible";

export interface LLMSettings {
  provider: LLMProvider;
  /** Ollama / compatible base URL (no trailing slash). */
  baseUrl: string;
  model: string;
  /** Cloud / compatible API key — stored only in localStorage. */
  apiKey: string;
  temperature: number;
}

export const SETTINGS_STORAGE_KEY = "liquid-copy.llm-settings.v1";

export const PROVIDER_PRESETS: Record<
  LLMProvider,
  { label: string; defaultBaseUrl: string; defaultModel: string; needsKey: boolean }
> = {
  ollama: {
    label: "Ollama (local)",
    defaultBaseUrl: "http://127.0.0.1:11434",
    defaultModel: "llama3.1",
    needsKey: false,
  },
  openai: {
    label: "OpenAI (ChatGPT)",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    needsKey: true,
  },
  anthropic: {
    label: "Anthropic (Claude)",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    needsKey: true,
  },
  openai_compatible: {
    label: "OpenAI-compatible (LM Studio, vLLM, …)",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    defaultModel: "local-model",
    needsKey: false,
  },
};

export function defaultSettings(provider: LLMProvider = "ollama"): LLMSettings {
  const preset = PROVIDER_PRESETS[provider];
  return {
    provider,
    baseUrl: preset.defaultBaseUrl,
    model: preset.defaultModel,
    apiKey: "",
    temperature: 0.4,
  };
}

export function loadSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as Partial<LLMSettings>;
    const provider = (parsed.provider ?? "ollama") as LLMProvider;
    const base = defaultSettings(provider);
    return {
      ...base,
      ...parsed,
      provider,
      baseUrl: String(parsed.baseUrl ?? base.baseUrl).replace(/\/$/, ""),
      model: String(parsed.model ?? base.model),
      apiKey: String(parsed.apiKey ?? ""),
      temperature:
        typeof parsed.temperature === "number" ? parsed.temperature : base.temperature,
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: LLMSettings): void {
  const cleaned: LLMSettings = {
    ...settings,
    baseUrl: settings.baseUrl.replace(/\/$/, ""),
  };
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(cleaned));
}

export function clearSettings(): void {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
}

export function isDemoWorkspace(): boolean {
  return !import.meta.env.VITE_API_BASE_URL;
}
