import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Progress, StreamingCaret } from "../../components/ui/Progress";
import { api } from "../../lib/api";
import type { RAGPassage } from "../../lib/types";
import "./workspace.css";

export function KnowledgePage() {
  const [query, setQuery] = useState("brand voice");
  const [results, setResults] = useState<RAGPassage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const passages = await api.search(query);
      setResults(passages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

      <Progress active={busy} label="Retrieving passages" />
      {error ? <p className="error-banner">{error}</p> : null}

      {results.length === 0 && !busy ? (
        <p className="empty-hint">
          Query the knowledge base
          <StreamingCaret />
        </p>
      ) : (
        <ul className="list-stack">
          {results.map((passage) => (
            <li key={`${passage.sourceDoc}-${passage.similarityScore}`} className="list-row">
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
      )}
    </div>
  );
}
