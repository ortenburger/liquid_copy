export type LLMProvider =
  | "ollama"
  | "openai"
  | "anthropic"
  | "openai_compatible";

export type DataMode = "simulation" | "real";

export interface LLMSettings {
  provider: LLMProvider;
  /** Ollama / compatible base URL (no trailing slash). */
  baseUrl: string;
  model: string;
  /** Cloud / compatible API key — stored only in localStorage. */
  apiKey: string;
  temperature: number;
  /**
   * Optional Claude key used when primary is Ollama (or a local compatible
   * server) and the local model is too slow or unreachable.
   */
  fallbackApiKey: string;
  fallbackModel: string;
}

export interface AppSettings {
  /** Demo fixtures vs live API / integrations. */
  dataMode: DataMode;
  /** Reduce workspace nav to Chat-first Simple UI. */
  simpleUi: boolean;
  /** Liquid Copy agent API origin when dataMode is real. */
  apiBaseUrl: string;
  firecrawlApiKey: string;
  /** Last company URL ingested from the Knowledge screen. */
  lastFirecrawlUrl: string;
  /** Zernio analytics API key (Bearer). */
  zernioApiKey: string;
  /** Zernio API root (no trailing slash). Docs: https://zernio.com/api/v1 */
  zernioApiBaseUrl: string;
  /** Optional connected account _id from GET /v1/accounts. */
  zernioAccountId: string;
  /** Preferred platform slug (linkedin, instagram, twitter, …). */
  zernioPlatform: string;
  openCarouselBaseUrl: string;
  llm: LLMSettings;
}

export const SETTINGS_STORAGE_KEY = "liquid-copy.app-settings.v2";
const LEGACY_LLM_KEY = "liquid-copy.llm-settings.v1";

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

const settingsListeners = new Set<() => void>();

export function subscribeSettings(listener: () => void): () => void {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}

function notifySettings(): void {
  for (const listener of settingsListeners) listener();
}

export function defaultLLMSettings(provider: LLMProvider = "ollama"): LLMSettings {
  const preset = PROVIDER_PRESETS[provider];
  return {
    provider,
    baseUrl: preset.defaultBaseUrl,
    model: preset.defaultModel,
    apiKey: "",
    temperature: 0.4,
    fallbackApiKey: "",
    fallbackModel: PROVIDER_PRESETS.anthropic.defaultModel,
  };
}

export const DEFAULT_API_BASE_URL = "http://localhost:8787";

export function defaultSettings(): AppSettings {
  return {
    dataMode: "simulation",
    simpleUi: false,
    apiBaseUrl:
      (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
        /\/$/,
        "",
      ) ?? DEFAULT_API_BASE_URL,
    firecrawlApiKey: "",
    lastFirecrawlUrl: "https://",
    zernioApiKey: "",
    zernioApiBaseUrl: "https://zernio.com/api/v1",
    zernioAccountId: "",
    zernioPlatform: "linkedin",
    openCarouselBaseUrl: "http://localhost:3000",
    llm: defaultLLMSettings("ollama"),
  };
}

/** Map legacy / shorthand bases onto the documented Zernio API root. */
export function normalizeZernioApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (
    !trimmed ||
    trimmed === "https://api.zernio.com" ||
    trimmed === "http://api.zernio.com"
  ) {
    return "https://zernio.com/api/v1";
  }
  if (
    trimmed === "https://zernio.com" ||
    trimmed === "https://www.zernio.com"
  ) {
    return "https://zernio.com/api/v1";
  }
  if (trimmed.endsWith("/api")) return `${trimmed}/v1`;
  return trimmed;
}

function parseLLM(raw: Partial<LLMSettings> | undefined): LLMSettings {
  const provider = (raw?.provider ?? "ollama") as LLMProvider;
  const base = defaultLLMSettings(
    provider in PROVIDER_PRESETS ? provider : "ollama",
  );
  return {
    ...base,
    ...raw,
    provider: base.provider,
    baseUrl: String(raw?.baseUrl ?? base.baseUrl).replace(/\/$/, ""),
    model: String(raw?.model ?? base.model),
    apiKey: String(raw?.apiKey ?? ""),
    temperature:
      typeof raw?.temperature === "number" ? raw.temperature : base.temperature,
    fallbackApiKey: String(raw?.fallbackApiKey ?? ""),
    fallbackModel: String(
      raw?.fallbackModel ?? PROVIDER_PRESETS.anthropic.defaultModel,
    ),
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      const base = defaultSettings();
      return {
        ...base,
        ...parsed,
        dataMode: parsed.dataMode === "real" ? "real" : "simulation",
        simpleUi: parsed.simpleUi === true,
        apiBaseUrl: String(parsed.apiBaseUrl ?? base.apiBaseUrl).replace(/\/$/, ""),
        firecrawlApiKey: String(parsed.firecrawlApiKey ?? ""),
        lastFirecrawlUrl: String(
          parsed.lastFirecrawlUrl ?? base.lastFirecrawlUrl,
        ),
        zernioApiKey: String(parsed.zernioApiKey ?? ""),
        zernioApiBaseUrl: normalizeZernioApiBaseUrl(
          String(parsed.zernioApiBaseUrl ?? base.zernioApiBaseUrl),
        ),
        zernioAccountId: String(parsed.zernioAccountId ?? ""),
        zernioPlatform: String(parsed.zernioPlatform ?? base.zernioPlatform),
        openCarouselBaseUrl: String(
          parsed.openCarouselBaseUrl ?? base.openCarouselBaseUrl,
        ).replace(/\/$/, ""),
        llm: parseLLM(parsed.llm),
      };
    }

    // Migrate v1 LLM-only blob
    const legacy = localStorage.getItem(LEGACY_LLM_KEY);
    if (legacy) {
      const llm = parseLLM(JSON.parse(legacy) as Partial<LLMSettings>);
      const migrated = { ...defaultSettings(), llm };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    return defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: AppSettings): void {
  const cleaned: AppSettings = {
    ...settings,
    apiBaseUrl: settings.apiBaseUrl.replace(/\/$/, ""),
    openCarouselBaseUrl: settings.openCarouselBaseUrl.replace(/\/$/, ""),
    zernioApiBaseUrl: normalizeZernioApiBaseUrl(settings.zernioApiBaseUrl),
    zernioAccountId: settings.zernioAccountId.trim(),
    zernioPlatform: settings.zernioPlatform.trim(),
    llm: {
      ...settings.llm,
      baseUrl: settings.llm.baseUrl.replace(/\/$/, ""),
    },
  };
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(cleaned));
  notifySettings();
}

export function clearSettings(): void {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
  localStorage.removeItem(LEGACY_LLM_KEY);
  notifySettings();
}

/** True when the UI should use in-browser demo fixtures. */
export function isDemoWorkspace(): boolean {
  return loadSettings().dataMode !== "real";
}

function isLocalLiquidApi(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      (u.port === "8787" || u.port === "")
    );
  } catch {
    return false;
  }
}

export function getApiBaseUrl(): string | undefined {
  const settings = loadSettings();
  if (settings.dataMode !== "real") return undefined;
  const url =
    settings.apiBaseUrl.trim() ||
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
    DEFAULT_API_BASE_URL;
  const normalized = url.replace(/\/$/, "") || DEFAULT_API_BASE_URL;
  // In Vite dev, prefer same-origin proxy to avoid CORS "Failed to fetch".
  if (
    typeof window !== "undefined" &&
    import.meta.env.DEV &&
    isLocalLiquidApi(normalized)
  ) {
    return "/__liquid-api";
  }
  return normalized;
}
