import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Markdown } from "../../components/ui/Markdown";
import { Progress } from "../../components/ui/Progress";
import { api } from "../../lib/api";
import { useDataMode } from "../../lib/hooks";
import { loadSettings, saveSettings } from "../../lib/settings";
import type { RAGPassage } from "../../lib/types";
import "./workspace.css";

export function KnowledgePage() {
  const { simulation } = useDataMode();
  const [query, setQuery] = useState("brand voice");
  const [companyUrl, setCompanyUrl] = useState(
    () => loadSettings().lastFirecrawlUrl || "https://",
  );
  const [results, setResults] = useState<RAGPassage[]>([]);
  const [busy, setBusy] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [kbStatus, setKbStatus] = useState<{
    entityCount: number;
    indexedDocuments: number;
  } | null>(null);

  const refreshKbStatus = useCallback(async () => {
    if (simulation) {
      setKbStatus(null);
      return;
    }
    try {
      const status = await api.getKnowledgeStatus();
      setKbStatus({
        entityCount: status.entityCount,
        indexedDocuments: status.indexedDocuments,
      });
    } catch {
      setKbStatus(null);
    }
  }, [simulation]);

  useEffect(() => {
    void refreshKbStatus();
  }, [refreshKbStatus]);

  function persistCompanyUrl(url: string) {
    setCompanyUrl(url);
    const settings = loadSettings();
    if (settings.lastFirecrawlUrl === url) return;
    saveSettings({ ...settings, lastFirecrawlUrl: url });
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSearched(true);
    try {
      const passages = await api.search(query);
      setResults(passages);
      void refreshKbStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  async function onIngest(e: FormEvent) {
    e.preventDefault();
    const url = companyUrl.trim();
    persistCompanyUrl(url);
    setIngestBusy(true);
    setIngestMsg(null);
    setError(null);
    try {
      const result = (await api.ingestCompany(url)) as {
        status?: string;
        warnings?: string[];
        companySummary?: { name?: string };
        draftId?: string;
        kbVersion?: string;
      };
      setIngestMsg(
        result.status === "firecrawl_error"
          ? `Firecrawl error${result.warnings?.[0] ? `: ${result.warnings[0]}` : ""}`
          : `Ingested${
              result.companySummary?.name
                ? ` · ${result.companySummary.name}`
                : ""
            }${result.kbVersion ? ` · KB ${result.kbVersion}` : ""}`,
      );
      void refreshKbStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIngestBusy(false);
    }
  }

  async function onClearKb() {
    if (
      !window.confirm(
        "Clear the entire knowledge base? This deletes all ingested company memory on disk and cannot be undone.",
      )
    ) {
      return;
    }
    setClearBusy(true);
    setError(null);
    setIngestMsg(null);
    try {
      const result = await api.clearKnowledge();
      setResults([]);
      setSearched(false);
      setIngestMsg(
        result.removed.length > 0
          ? `Cleared ${result.removed.length} KB entit${result.removed.length === 1 ? "y" : "ies"}`
          : "Knowledge base was already empty",
      );
      void refreshKbStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearBusy(false);
    }
  }

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">RAG retrieval</p>
          <h1 className="page-title">Knowledge</h1>
        </div>
        {!simulation ? (
          <Button
            variant="ghost"
            disabled={clearBusy || (kbStatus?.entityCount ?? 0) === 0}
            onClick={() => void onClearKb()}
          >
            Clear knowledge base
          </Button>
        ) : null}
      </header>

      {!simulation && kbStatus ? (
        <p className="panel-meta">
          Persistent on disk · {kbStatus.entityCount} entit
          {kbStatus.entityCount === 1 ? "y" : "ies"} · {kbStatus.indexedDocuments}{" "}
          indexed for search
        </p>
      ) : null}

      {!simulation ? (
        <form className="search-form" onSubmit={onIngest}>
          <Input
            label="Ingest company URL (Firecrawl)"
            value={companyUrl}
            onChange={(e) => persistCompanyUrl(e.target.value)}
            placeholder="https://yourcompany.com"
          />
          <Button type="submit" variant="primary" disabled={ingestBusy}>
            Ingest
          </Button>
        </form>
      ) : null}
      {ingestMsg ? <p className="info-banner">{ingestMsg}</p> : null}

      <form className="search-form" onSubmit={onSearch}>
        <Input
          ai
          label="Natural language search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company memory, experiments, audiences…"
        />
        <Button type="submit" variant="accent" disabled={busy}>
          Search
        </Button>
      </form>

      <Progress
        active={busy || ingestBusy || clearBusy}
        label="Talking to the knowledge layer"
      />
      {error ? <p className="error-banner">{error}</p> : null}

      {busy ? null : results.length > 0 ? (
        <ul className="list-stack">
          {results.map((passage) => (
            <li
              key={`${passage.sourceDoc}-${passage.similarityScore}-${passage.content.slice(0, 24)}`}
              className="list-row"
            >
              <div className="list-row-main">
                <div className="list-row-title">
                  <span className="mono-tag">{passage.scope}</span>
                  <span className="mono-tag">
                    {(passage.similarityScore * 100).toFixed(0)}% match
                  </span>
                </div>
                <Markdown source={passage.content} className="list-row-body" />
                <p className="card-meta">{passage.sourceDoc}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : searched ? (
        <p className="empty-hint">
          {simulation
            ? "No matching passages in the demo fixtures."
            : "No passages yet. Ingest a company URL above, then search again."}
        </p>
      ) : null}
    </div>
  );
}
