import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Progress, StreamingCaret } from "../../components/ui/Progress";
import { ParsedOutput } from "../../components/workspace/ParsedOutput";
import { api, type RagMarkdownSource } from "../../lib/api";
import { useDataMode } from "../../lib/hooks";
import type {
  KBDocumentView,
  KBEntitySummary,
  KBEntityType,
  RAGPassage,
  RetrievalScope,
} from "../../lib/types";
import "./workspace.css";
import "./Organization.css";
import "../../components/ui/Input.css";

const SCOPES: Array<{ id: RetrievalScope | "all"; label: string }> = [
  { id: "all", label: "All scopes" },
  { id: "company_memory", label: "Company" },
  { id: "product_context", label: "Product" },
  { id: "audience_learning", label: "Audience" },
  { id: "experiment_history", label: "Experiments" },
];

const TYPE_TONE: Record<
  KBEntityType,
  "active" | "processing" | "idle" | "failed"
> = {
  company_identity: "active",
  product: "processing",
  audience: "idle",
  experiment: "failed",
};

function formatWhen(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Split markdown into H1 sections for readable KB browsing. */
function splitMarkdownSections(markdown: string): Array<{
  title: string;
  body: string;
}> {
  const parts = markdown.split(/^# /m).filter(Boolean);
  return parts.map((part) => {
    const nl = part.indexOf("\n");
    if (nl === -1) return { title: part.trim(), body: "" };
    return {
      title: part.slice(0, nl).trim(),
      body: part.slice(nl + 1).trim(),
    };
  });
}

export function OrganizationPage() {
  const { simulation } = useDataMode();
  const [entities, setEntities] = useState<KBEntitySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<KBDocumentView | null>(null);
  const [query, setQuery] = useState("brand voice mission");
  const [scope, setScope] = useState<RetrievalScope | "all">("all");
  const [results, setResults] = useState<RAGPassage[]>([]);
  const [mdSources, setMdSources] = useState<RagMarkdownSource[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerMeta, setAnswerMeta] = useState<string | null>(null);
  const [busyList, setBusyList] = useState(false);
  const [busyDoc, setBusyDoc] = useState(false);
  const [busySearch, setBusySearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const selectedMeta = useMemo(
    () => entities.find((e) => e.entityId === selectedId) ?? null,
    [entities, selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    setBusyList(true);
    void api
      .listKBEntities()
      .then((rows) => {
        if (cancelled) return;
        setEntities(rows);
        setSelectedId((prev) => prev ?? rows[0]?.entityId ?? null);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setBusyList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [simulation]);

  useEffect(() => {
    if (!selectedId) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    setBusyDoc(true);
    void api
      .getKBEntity(selectedId)
      .then((view) => {
        if (!cancelled) {
          setDoc(view);
          setShowRaw(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setBusyDoc(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setBusySearch(true);
    setError(null);
    setAnswer(null);
    setAnswerMeta(null);
    setMdSources([]);
    try {
      const result = await api.ragAsk(query, {
        scope: scope === "all" ? undefined : scope,
      });
      setResults(result.passages);
      setMdSources(result.markdownSources);
      setAnswer(result.answer);
      setAnswerMeta(
        `${result.provider} · ${result.model} · ${result.passages.length} passages · ${result.markdownSources.length} md files`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySearch(false);
    }
  }

  const sections = doc?.markdown ? splitMarkdownSections(doc.markdown) : [];

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Knowledge base · RAG</p>
          <h1 className="page-title">Organization</h1>
        </div>
        <Badge tone={simulation ? "processing" : "active"}>
          {simulation ? "Simulation" : "Live KB"}
        </Badge>
      </header>

      <p className="page-lead">
        Browse versioned markdown entities from the knowledge base and query the
        RAG index. Ingest or generate context via{" "}
        <Link to="/app/testing-plan">Testing plan</Link>
        {!simulation ? (
          <>
            {" "}
            / full <Link to="/app/knowledge">Knowledge</Link>
          </>
        ) : null}
        .
      </p>

      {error ? <p className="error-banner">{error}</p> : null}

      <div className="org-layout">
        <aside className="panel org-entities">
          <div className="panel-head">
            <h2 className="panel-title">KB entities</h2>
            <span className="panel-meta">{entities.length} docs</span>
          </div>
          {busyList ? (
            <p className="empty-state">
              Loading entities
              <StreamingCaret />
            </p>
          ) : entities.length === 0 ? (
            <p className="empty-state">
              No markdown entities yet.
              {!simulation
                ? " Ingest a company or run the workflow to write KB files."
                : " Demo fixtures should load — refresh the page."}
            </p>
          ) : (
            <ul className="org-entity-list">
              {entities.map((entity) => (
                <li key={entity.entityId}>
                  <button
                    type="button"
                    className={`org-entity-btn ${
                      selectedId === entity.entityId ? "is-active" : ""
                    }`}
                    onClick={() => setSelectedId(entity.entityId)}
                  >
                    <span className="org-entity-id">{entity.entityId}</span>
                    <span className="org-entity-meta">
                      <Badge tone={TYPE_TONE[entity.entityType]}>
                        {entity.entityType}
                      </Badge>
                      <span className="panel-meta">v{entity.latestVersion}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="panel org-doc">
          <div className="panel-head">
            <h2 className="panel-title">
              {selectedId ?? "Document"}
            </h2>
            <div className="org-doc-actions">
              {selectedMeta ? (
                <>
                  <Badge tone={TYPE_TONE[selectedMeta.entityType]}>
                    {selectedMeta.entityType}
                  </Badge>
                  <span className="panel-meta">
                    v{selectedMeta.latestVersion}
                    {selectedMeta.updatedAt
                      ? ` · ${formatWhen(selectedMeta.updatedAt)}`
                      : ""}
                  </span>
                </>
              ) : null}
              {doc?.markdown ? (
                <Button
                  variant="ghost"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  {showRaw ? "Structured" : "Raw markdown"}
                </Button>
              ) : null}
            </div>
          </div>

          <Progress active={busyDoc} label="Reading KB markdown" />

          {!selectedId ? (
            <p className="empty-state">Select an entity to open its markdown.</p>
          ) : !doc?.found || !doc.markdown ? (
            <p className="empty-state">
              Entity not found or empty current snapshot.
            </p>
          ) : showRaw ? (
            <pre className="org-markdown-raw">{doc.markdown}</pre>
          ) : (
            <div className="org-sections">
              {sections.map((section) => (
                <article key={section.title} className="org-section">
                  <h3 className="org-section-title">{section.title}</h3>
                  {section.body.includes("{") || section.body.includes("[") ? (
                    <ParsedOutput raw={section.body} />
                  ) : (
                    <pre className="org-markdown-body">{section.body || "—"}</pre>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Ask with RAG</h2>
          <span className="panel-meta">retrieve → Ollama</span>
        </div>
        <p className="page-lead" style={{ marginBottom: "var(--space-md)" }}>
          Retrieves KB passages, then calls your Settings LLM (Ollama) with those
          passages as context. Configure model under{" "}
          <Link to="/app/settings">Settings</Link>.
        </p>
        <form className="search-form" onSubmit={(e) => void onSearch(e)}>
          <Input
            ai
            label="Ask company memory, products, audiences, experiments"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What is our brand voice?"
          />
          <Button type="submit" variant="accent" disabled={busySearch}>
            Ask
          </Button>
        </form>
        <div className="chip-cloud org-scopes">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`org-scope-chip ${scope === s.id ? "is-active" : ""}`}
              onClick={() => setScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Progress
          active={busySearch}
          label="RAG + markdown → talking to Ollama"
        />

        {answer ? (
          <div className="org-answer">
            <div className="panel-head" style={{ borderBottom: "none", marginBottom: 0 }}>
              <h3 className="panel-title">Answer</h3>
              {answerMeta ? (
                <span className="panel-meta">{answerMeta}</span>
              ) : null}
            </div>
            <pre className="org-answer-body">
              {answer}
              {busySearch ? <StreamingCaret /> : null}
            </pre>
          </div>
        ) : null}

        {results.length === 0 && mdSources.length === 0 && !busySearch && !answer ? (
          <p className="empty-state">
            Ask a question to load KB markdown + RAG passages into Ollama.
          </p>
        ) : null}

        {mdSources.length > 0 ? (
          <>
            <div className="panel-head" style={{ marginTop: "var(--space-md)" }}>
              <h3 className="panel-title">Markdown context</h3>
              <span className="panel-meta">{mdSources.length} files</span>
            </div>
            <ul className="chip-cloud org-scopes">
              {mdSources.map((m) => (
                <li key={m.entityId}>
                  <button
                    type="button"
                    className="org-scope-chip is-active"
                    onClick={() => setSelectedId(m.entityId)}
                  >
                    {m.entityId}.md
                    {m.entityType ? ` · ${m.entityType}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {results.length > 0 ? (
          <>
            <div className="panel-head" style={{ marginTop: "var(--space-md)" }}>
              <h3 className="panel-title">Retrieved passages</h3>
              <span className="panel-meta">{results.length} passages</span>
            </div>
            <ul className="list-stack">
              {results.map((passage) => (
                <li
                  key={`${passage.sourceDoc}-${passage.similarityScore}-${passage.content.slice(0, 24)}`}
                  className="list-row"
                >
                  <div className="list-row-main">
                    <div className="list-row-title">
                      <Badge tone="idle">{passage.scope}</Badge>
                      <Badge tone="processing">
                        {(passage.similarityScore * 100).toFixed(0)}% match
                      </Badge>
                      <button
                        type="button"
                        className="org-source-link"
                        onClick={() => {
                          const id = passage.sourceDoc
                            .replace(/_v\d+$/, "")
                            .replace(/^company_identity$/, "liquid-copy");
                          const match = entities.find(
                            (e) =>
                              e.entityId === id ||
                              e.entityId.includes(id) ||
                              passage.sourceDoc.includes(e.entityId),
                          );
                          if (match) setSelectedId(match.entityId);
                        }}
                      >
                        {passage.sourceDoc}
                      </button>
                    </div>
                    <p className="list-row-body">{passage.content}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}
