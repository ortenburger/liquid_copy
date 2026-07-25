import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Progress, StreamingCaret } from "../../components/ui/Progress";
import { Toggle } from "../../components/ui/Toggle";
import { api } from "../../lib/api";
import { listOllamaModels, testLLMConnection } from "../../lib/llm-browser";
import {
  PROVIDER_PRESETS,
  clearSettings,
  defaultLLMSettings,
  defaultSettings,
  loadSettings,
  saveSettings,
  type AppSettings,
  type LLMProvider,
} from "../../lib/settings";
import "./workspace.css";
import "./Settings.css";
import "../../components/ui/Input.css";
import "../../components/ui/Toggle.css";

export function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [apiHealth, setApiHealth] = useState<string | null>(null);
  const [zernioSimOut, setZernioSimOut] = useState<string | null>(null);
  const [zernioSimBusy, setZernioSimBusy] = useState(false);
  const [testOut, setTestOut] = useState<{
    ok: boolean;
    message: string;
    sample?: string;
  } | null>(null);

  const llm = settings.llm;
  const preset = PROVIDER_PRESETS[llm.provider];
  const realMode = settings.dataMode === "real";
  const simpleUi = settings.simpleUi;

  useEffect(() => {
    if (llm.provider !== "ollama") {
      setModels([]);
      return;
    }
    let cancelled = false;
    setListing(true);
    void listOllamaModels(llm.baseUrl)
      .then((names) => {
        if (!cancelled) setModels(names);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setListing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [llm.provider, llm.baseUrl]);

  function patch(partial: Partial<AppSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    setSavedAt(null);
  }

  function patchLlm<K extends keyof AppSettings["llm"]>(
    key: K,
    value: AppSettings["llm"][K],
  ) {
    setSettings((prev) => ({
      ...prev,
      llm: { ...prev.llm, [key]: value },
    }));
    setSavedAt(null);
    setTestOut(null);
  }

  function onProviderChange(provider: LLMProvider) {
    const next = defaultLLMSettings(provider);
    // Keep cloud keys when switching providers.
    if (PROVIDER_PRESETS[provider].needsKey) {
      next.apiKey =
        settings.llm.apiKey ||
        (provider === "anthropic" ? settings.llm.fallbackApiKey : "");
    }
    next.fallbackApiKey =
      settings.llm.fallbackApiKey ||
      (settings.llm.provider === "anthropic" ? settings.llm.apiKey : "");
    next.fallbackModel =
      settings.llm.fallbackModel || PROVIDER_PRESETS.anthropic.defaultModel;
    next.temperature = settings.llm.temperature;
    patch({ llm: next });
    setTestOut(null);
  }

  async function onSave() {
    const next = {
      ...settings,
      apiBaseUrl:
        settings.apiBaseUrl.trim() || "http://localhost:8787",
    };
    setSettings(next);
    saveSettings(next);
    setSavedAt(new Date().toLocaleTimeString());
    if (next.dataMode === "real" && next.apiBaseUrl.trim()) {
      try {
        await api.syncConfig();
      } catch {
        /* API may be down — settings still saved locally */
      }
    }
  }

  function onReset() {
    clearSettings();
    setSettings(defaultSettings());
    setSavedAt(null);
    setTestOut(null);
    setModels([]);
    setApiHealth(null);
  }

  async function onTest() {
    setBusy(true);
    setTestOut(null);
    try {
      const result = await testLLMConnection(settings.llm);
      setTestOut(result);
      if (result.models?.length) setModels(result.models);
    } finally {
      setBusy(false);
    }
  }

  async function onPingApi() {
    setApiHealth(null);
    saveSettings(settings);
    try {
      const health = await fetch(
        `${settings.apiBaseUrl.replace(/\/$/, "")}/api/content-creator-ai/health`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!health.ok) {
        setApiHealth(`API responded ${health.status}`);
        return;
      }
      const body = (await health.json()) as { service?: string };
      setApiHealth(`Connected · ${body.service ?? "ok"}`);
      if (settings.dataMode === "real") {
        await api.syncConfig().catch(() => undefined);
      }
    } catch (e) {
      setApiHealth(
        e instanceof Error
          ? e.message
          : "Cannot reach API — run npm run api:dev",
      );
    }
  }

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Integrations & data</p>
          <h1 className="page-title">Settings</h1>
        </div>
        <div className="mode-toggle">
          <Button variant="ghost" onClick={onReset}>
            Reset
          </Button>
          <Button variant="primary" onClick={onSave}>
            Save
          </Button>
        </div>
      </header>

      <p className="page-lead">
        Keys and URLs stay in this browser&apos;s localStorage. Simulation mode
        drives the workspace with fixtures; real mode calls your Liquid Copy API.
        The carousel studio lives under{" "}
        <Link to="/app/carousels">Carousels</Link>.
      </p>

      {savedAt ? (
        <p className="panel-meta">Saved · {savedAt}</p>
      ) : (
        <p className="panel-meta">Unsaved changes</p>
      )}

      {/* Interface */}
      <section className="panel settings-panel">
        <div className="panel-head">
          <h2 className="panel-title">Interface</h2>
          <Badge tone={simpleUi ? "active" : "idle"}>
            {simpleUi ? "Simple" : "Full"}
          </Badge>
        </div>
        <Toggle
          checked={simpleUi}
          onChange={(on) => {
            const next = { ...settings, simpleUi: on };
            setSettings(next);
            saveSettings(next);
            setSavedAt(new Date().toLocaleTimeString());
            navigate("/app", { replace: true });
          }}
          label="Simple UI"
          description="Reduce navigation to Chat (with live workflow stages), Testing plan, Test, and Settings."
        />
      </section>

      {/* Data mode */}
      <section className="panel settings-panel">
        <div className="panel-head">
          <h2 className="panel-title">Data mode</h2>
          <Badge tone={realMode ? "active" : "processing"}>
            {realMode ? "Real" : "Simulation"}
          </Badge>
        </div>
        <Toggle
          checked={realMode}
          onChange={(on) => {
            const next = {
              ...settings,
              dataMode: on ? ("real" as const) : ("simulation" as const),
              apiBaseUrl:
                settings.apiBaseUrl.trim() ||
                "http://localhost:8787",
            };
            setSettings(next);
            saveSettings(next);
            setSavedAt(new Date().toLocaleTimeString());
          }}
          label="Use real data"
          description="Off = in-browser demo fixtures. On = call the Liquid Copy API base URL below (agents, KB, workflow). Saves immediately."
        />
        <div className="settings-fields">
          <Input
            label="Liquid Copy API base URL"
            value={settings.apiBaseUrl}
            onChange={(e) => patch({ apiBaseUrl: e.target.value })}
            placeholder="http://localhost:8787"
            disabled={!realMode}
          />
        </div>
        <div className="list-row-actions settings-actions">
          <Button
            variant="ghost"
            disabled={!settings.apiBaseUrl.trim()}
            onClick={() => void onPingApi()}
          >
            Ping API
          </Button>
          {apiHealth ? (
            <Badge
              tone={apiHealth.startsWith("Connected") ? "active" : "failed"}
            >
              {apiHealth}
            </Badge>
          ) : null}
        </div>
        <p className="settings-note">
          Start the local API with <code>npm run api:dev</code> (port 8787), then
          enable real data. Or run the full stack: <code>npm run dev:stack</code>.
        </p>
      </section>

      {/* Firecrawl */}
      <section className="panel settings-panel">
        <div className="panel-head">
          <h2 className="panel-title">Firecrawl</h2>
          <span className="panel-meta">Company context ingestion</span>
        </div>
        <div className="settings-fields">
          <Input
            label="Firecrawl API key"
            type="password"
            autoComplete="off"
            value={settings.firecrawlApiKey}
            onChange={(e) => patch({ firecrawlApiKey: e.target.value })}
            placeholder="fc-…"
          />
        </div>
        <p className="settings-note">
          Used by Open Carrusel brand setup (Fill from URL) when the studio is
          embedded, and by Context Agent on a live API. Pass the same key into
          the Open Carrusel process as <code>FIRECRAWL_API_KEY</code> if you run
          the studio alone.
        </p>
      </section>

      {/* Zernio */}
      <section className="panel settings-panel">
        <div className="panel-head">
          <h2 className="panel-title">Zernio</h2>
          <span className="panel-meta">Publish &amp; analytics</span>
        </div>
        <div className="settings-fields">
          <Input
            label="Zernio API key"
            type="password"
            autoComplete="off"
            value={settings.zernioApiKey}
            onChange={(e) => patch({ zernioApiKey: e.target.value })}
            placeholder="sk_…"
          />
          <Input
            label="Zernio API base URL"
            value={settings.zernioApiBaseUrl}
            onChange={(e) => patch({ zernioApiBaseUrl: e.target.value })}
            placeholder="https://zernio.com/api/v1"
          />
          <Input
            label="Preferred platform"
            value={settings.zernioPlatform}
            onChange={(e) => patch({ zernioPlatform: e.target.value })}
            placeholder="linkedin"
          />
          <Input
            label="Account ID (optional)"
            value={settings.zernioAccountId}
            onChange={(e) => patch({ zernioAccountId: e.target.value })}
            placeholder="From GET /v1/accounts → _id"
          />
        </div>
        <p className="settings-note">
          Base must be <code>https://zernio.com/api/v1</code>. Connect a social
          account in the{" "}
          <a href="https://zernio.com" target="_blank" rel="noreferrer">
            Zernio dashboard
          </a>
          , then paste its account <code>_id</code> (or leave blank for the first
          connected account). Test → Publish exports Open Carrusel slide PNGs as
          a multi-image carousel. Keep Open Carrusel running for export; use
          Simulate when the live API is unavailable.
        </p>
        <div className="list-row-actions" style={{ marginTop: "var(--space-md)" }}>
          <Button
            variant="accent"
            disabled={zernioSimBusy}
            onClick={() => {
              void (async () => {
                setZernioSimBusy(true);
                setZernioSimOut(null);
                try {
                  const result = await api.publishCarouselToZernio(
                    {
                      id: `settings-sim-${Date.now().toString(36)}`,
                      name: "Settings · Zernio simulation",
                      aspectRatio: "4:5",
                      slideCount: 1,
                      slides: [
                        {
                          id: "s1",
                          html: "<div>Simulated slide for Zernio dry-run</div>",
                          order: 0,
                        },
                      ],
                      caption: "Dry-run publish from Liquid Copy Settings.",
                      updatedAt: new Date().toISOString(),
                      status: "queued",
                    },
                    { simulate: true },
                  );
                  setZernioSimOut(result.message);
                } catch (e) {
                  setZernioSimOut(
                    e instanceof Error ? e.message : String(e),
                  );
                } finally {
                  setZernioSimBusy(false);
                }
              })();
            }}
          >
            {zernioSimBusy ? "Simulating…" : "Simulate Zernio"}
          </Button>
          <Link to="/app/test" className="panel-meta">
            Open Test queue →
          </Link>
        </div>
        {zernioSimOut ? (
          <p className="info-banner" style={{ marginTop: "var(--space-sm)" }}>
            {zernioSimOut}
          </p>
        ) : null}
      </section>

      {/* LLM */}
      <section className="panel settings-panel">
        <div className="panel-head">
          <h2 className="panel-title">Language model</h2>
        </div>

        <div className="provider-grid">
          {(Object.keys(PROVIDER_PRESETS) as LLMProvider[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`provider-card ${llm.provider === id ? "is-active" : ""}`}
              onClick={() => onProviderChange(id)}
            >
              <span className="provider-label">{PROVIDER_PRESETS[id].label}</span>
              <span className="provider-hint">
                {PROVIDER_PRESETS[id].needsKey ? "API key" : "No key required"}
              </span>
            </button>
          ))}
        </div>

        <div className="settings-fields">
          <Input
            label="Base URL"
            value={llm.baseUrl}
            onChange={(e) => patchLlm("baseUrl", e.target.value)}
            placeholder={preset.defaultBaseUrl}
          />
          <label className="field">
            <span className="field-label">Model</span>
            {models.length > 0 ? (
              <select
                className="field-input settings-select"
                value={llm.model}
                onChange={(e) => patchLlm("model", e.target.value)}
              >
                {!models.includes(llm.model) ? (
                  <option value={llm.model}>{llm.model}</option>
                ) : null}
                {models.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="field-input"
                value={llm.model}
                onChange={(e) => patchLlm("model", e.target.value)}
                placeholder={preset.defaultModel}
              />
            )}
          </label>
          {preset.needsKey || llm.provider === "openai_compatible" ? (
            <Input
              label={preset.needsKey ? "API key" : "API key (optional)"}
              type="password"
              autoComplete="off"
              value={llm.apiKey}
              onChange={(e) => patchLlm("apiKey", e.target.value)}
              placeholder={preset.needsKey ? "sk-…" : "optional"}
            />
          ) : null}
          <label className="field">
            <span className="field-label">
              Temperature · {llm.temperature.toFixed(1)}
            </span>
            <input
              className="settings-range"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={llm.temperature}
              onChange={(e) => patchLlm("temperature", Number(e.target.value))}
            />
          </label>
        </div>

        {llm.provider === "ollama" || llm.provider === "openai_compatible" ? (
          <div className="settings-fallback">
            <div className="panel-head">
              <h3 className="panel-title" style={{ fontSize: "1rem" }}>
                Claude fallback
              </h3>
              <span className="panel-meta">if local is slow or down</span>
            </div>
            <div className="settings-fields">
              <Input
                label="Anthropic API key (optional)"
                type="password"
                autoComplete="off"
                value={llm.fallbackApiKey}
                onChange={(e) => patchLlm("fallbackApiKey", e.target.value)}
                placeholder="sk-ant-…"
              />
              <Input
                label="Claude model"
                value={llm.fallbackModel}
                onChange={(e) => patchLlm("fallbackModel", e.target.value)}
                placeholder={PROVIDER_PRESETS.anthropic.defaultModel}
                disabled={!llm.fallbackApiKey.trim()}
              />
            </div>
            <p className="settings-note">
              Primary stays local. If Ollama does not answer within ~8s, the API
              retries the same prompt on Claude. Synced to the local API when you
              Save in real-data mode.
            </p>
          </div>
        ) : null}

        <div className="list-row-actions settings-actions">
          <Button variant="accent" disabled={busy} onClick={() => void onTest()}>
            Test connection
          </Button>
          {listing ? <Badge tone="processing">Listing models</Badge> : null}
          {models.length > 0 ? (
            <Badge tone="active">{models.length} models found</Badge>
          ) : null}
        </div>

        <Progress active={busy} label="Talking to the model" />

        {testOut ? (
          <div
            className={`settings-result ${testOut.ok ? "is-ok" : "is-fail"}`}
            role="status"
          >
            <p className="settings-result-msg">
              {testOut.message}
              {busy ? <StreamingCaret /> : null}
            </p>
            {testOut.sample ? (
              <pre className="settings-result-sample">{testOut.sample}</pre>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Open Carrusel connection */}
      <section className="panel settings-panel">
        <div className="panel-head">
          <h2 className="panel-title">Open Carrusel</h2>
          <span className="panel-meta">embedded in workspace</span>
        </div>
        <div className="settings-fields">
          <Input
            label="Studio base URL"
            value={settings.openCarouselBaseUrl}
            onChange={(e) => patch({ openCarouselBaseUrl: e.target.value })}
            placeholder="http://localhost:3000"
          />
        </div>
        <p className="settings-note">
          When Content Generation runs, company data from Knowledge is pushed into
          Open Carrusel brand settings automatically — no second Firecrawl scrape.
          Keep the studio at this URL (
          <code>cd open-carrusel && npm run dev</code>).
        </p>
        <div className="list-row-actions settings-actions">
          <Link to="/app/carousels">
            <Button variant="primary">Open in workspace</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
