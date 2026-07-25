import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Progress, StreamingCaret } from "../../components/ui/Progress";
import { Toggle } from "../../components/ui/Toggle";
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
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [testOut, setTestOut] = useState<{
    ok: boolean;
    message: string;
    sample?: string;
  } | null>(null);

  const llm = settings.llm;
  const preset = PROVIDER_PRESETS[llm.provider];
  const realMode = settings.dataMode === "real";

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
    if (PROVIDER_PRESETS[provider].needsKey) {
      next.apiKey = settings.llm.apiKey;
    }
    patch({ llm: next });
    setTestOut(null);
  }

  function onSave() {
    saveSettings(settings);
    setSavedAt(new Date().toLocaleTimeString());
  }

  function onReset() {
    clearSettings();
    setSettings(defaultSettings());
    setSavedAt(null);
    setTestOut(null);
    setModels([]);
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
          onChange={(on) => patch({ dataMode: on ? "real" : "simulation" })}
          label="Use real data"
          description="Off = in-browser demo fixtures. On = call the Liquid Copy API base URL below (agents, KB, workflow)."
        />
        <div className="settings-fields">
          <Input
            label="Liquid Copy API base URL"
            value={settings.apiBaseUrl}
            onChange={(e) => patch({ apiBaseUrl: e.target.value })}
            placeholder="http://localhost:3001"
            disabled={!realMode}
          />
        </div>
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
          Used by Context Agent when running against a live API. Stored locally
          only — pass it into the API process as <code>FIRECRAWL_API_KEY</code>{" "}
          for server-side scrapes.
        </p>
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
          Open Carrusel runs inside Liquid Copy at{" "}
          <Link to="/app/carousels">/app/carousels</Link>. Keep{" "}
          <code>open-carrusel</code> on this URL (
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
