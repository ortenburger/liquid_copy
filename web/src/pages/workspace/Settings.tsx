import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Progress, StreamingCaret } from "../../components/ui/Progress";
import { listOllamaModels, testLLMConnection } from "../../lib/llm-browser";
import {
  PROVIDER_PRESETS,
  clearSettings,
  defaultSettings,
  loadSettings,
  saveSettings,
  type LLMProvider,
  type LLMSettings,
} from "../../lib/settings";
import "./workspace.css";
import "./Settings.css";
import "../../components/ui/Input.css";

export function SettingsPage() {
  const [settings, setSettings] = useState<LLMSettings>(() => loadSettings());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [testOut, setTestOut] = useState<{
    ok: boolean;
    message: string;
    sample?: string;
  } | null>(null);

  const preset = PROVIDER_PRESETS[settings.provider];

  useEffect(() => {
    if (settings.provider !== "ollama") {
      setModels([]);
      return;
    }
    let cancelled = false;
    setListing(true);
    void listOllamaModels(settings.baseUrl)
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
  }, [settings.provider, settings.baseUrl]);

  function update<K extends keyof LLMSettings>(key: K, value: LLMSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
    setTestOut(null);
  }

  function onProviderChange(provider: LLMProvider) {
    const next = defaultSettings(provider);
    // Keep a typed key when switching among cloud providers
    if (PROVIDER_PRESETS[provider].needsKey) {
      next.apiKey = settings.apiKey;
    }
    setSettings(next);
    setSavedAt(null);
    setTestOut(null);
  }

  function onSave() {
    saveSettings(settings);
    setSavedAt(new Date().toLocaleTimeString());
  }

  function onReset() {
    clearSettings();
    setSettings(defaultSettings("ollama"));
    setSavedAt(null);
    setTestOut(null);
    setModels([]);
  }

  async function onTest() {
    setBusy(true);
    setTestOut(null);
    try {
      const result = await testLLMConnection(settings);
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
          <p className="eyebrow">Model providers</p>
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
        Configure a local Ollama model or paste a cloud API key. Keys stay in
        this browser&apos;s localStorage only — they are not sent to Liquid Copy
        servers. The workspace UI still uses demo workflow data unless you also
        point <code>VITE_API_BASE_URL</code> at a live API.
      </p>

      <section className="panel settings-panel">
        <div className="panel-head">
          <h2 className="panel-title">Provider</h2>
          {savedAt ? (
            <span className="panel-meta">Saved · {savedAt}</span>
          ) : (
            <span className="panel-meta">Unsaved changes</span>
          )}
        </div>

        <div className="provider-grid">
          {(Object.keys(PROVIDER_PRESETS) as LLMProvider[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`provider-card ${settings.provider === id ? "is-active" : ""}`}
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
            value={settings.baseUrl}
            onChange={(e) => update("baseUrl", e.target.value)}
            placeholder={preset.defaultBaseUrl}
          />
          <label className="field">
            <span className="field-label">Model</span>
            {models.length > 0 ? (
              <select
                className="field-input settings-select"
                value={settings.model}
                onChange={(e) => update("model", e.target.value)}
              >
                {!models.includes(settings.model) ? (
                  <option value={settings.model}>{settings.model}</option>
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
                value={settings.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder={preset.defaultModel}
              />
            )}
          </label>
          {preset.needsKey || settings.provider === "openai_compatible" ? (
            <Input
              label={preset.needsKey ? "API key" : "API key (optional)"}
              type="password"
              autoComplete="off"
              value={settings.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder={preset.needsKey ? "sk-…" : "optional"}
            />
          ) : null}
          <label className="field">
            <span className="field-label">
              Temperature · {settings.temperature.toFixed(1)}
            </span>
            <input
              className="settings-range"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={settings.temperature}
              onChange={(e) => update("temperature", Number(e.target.value))}
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
    </div>
  );
}
