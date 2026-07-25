import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Progress, StreamingCaret } from "../../components/ui/Progress";
import { api } from "../../lib/api";
import { useDataMode } from "../../lib/hooks";
import { getApiBaseUrl } from "../../lib/settings";
import type { RAGPassage } from "../../lib/types";
import "./workspace.css";

export function KnowledgePage() {
  const { simulation } = useDataMode();
  const [query, setQuery] = useState("brand voice");
  const [companyUrl, setCompanyUrl] = useState("https://");
  const [results, setResults] = useState<RAGPassage[]>([]);
  const [busy, setBusy] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const apiBase = getApiBaseUrl();

  const [answer, setAnswer] = useState<string | null>(null);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await api.ragAsk(query);
      setResults(result.passages);
      setAnswer(result.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onIngest(e: FormEvent) {
    e.preventDefault();
    setIngestBusy(true);
    setIngestMsg(null);
    setError(null);
    try {
      const result = (await api.ingestCompany(companyUrl.trim())) as {
        status?: string;
        warnings?: string[];
        companySummary?: { name?: string };
        draftId?: string;
      };
      setIngestMsg(
        result.status === "firecrawl_error"
          ? `Firecrawl error${result.warnings?.[0] ? `: ${result.warnings[0]}` : ""}`
          : `Ingest ${result.status ?? "ok"}${
              result.companySummary?.name
                ? ` · ${result.companySummary.name}`
                : ""
            }${result.draftId ? ` · draft ${result.draftId}` : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIngestBusy(false);
    }
  }

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">RAG retrieval</p>
          <h1 className="page-title">Knowledge</h1>
        </div>
      </header>

      {!simulation ? (
        <>
          <p className="info-banner">
            Live ingest → API at <code>{apiBase ?? "not set"}</code>. Firecrawl
            key is sent from Settings. Need{" "}
            <Link to="/app/settings">Settings</Link> saved +{" "}
            <code>npm run api:dev</code>.
          </p>
          <form className="search-form" onSubmit={onIngest}>
            <Input
              label="Ingest company URL (Firecrawl)"
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
              placeholder="https://yourcompany.com"
            />
            <Button type="submit" variant="primary" disabled={ingestBusy}>
              Ingest
            </Button>
          </form>
        </>
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
        active={busy || ingestBusy}
        label="RAG retrieve → Ollama answer"
      />
      {error ? <p className="error-banner">{error}</p> : null}

      {answer ? (
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Answer</h2>
            <span className="panel-meta">grounded in RAG</span>
          </div>
          <p className="list-row-body" style={{ whiteSpace: "pre-wrap" }}>
            {answer}
            {busy ? <StreamingCaret /> : null}
          </p>
        </div>
      ) : null}

      {results.length === 0 && !busy && !answer ? (
        <p className="empty-hint">
          Query the knowledge base
          <StreamingCaret />
        </p>
      ) : results.length > 0 ? (
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
                <p className="list-row-body">{passage.content}</p>
                <p className="card-meta">{passage.sourceDoc}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
