import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { useDataMode } from "../../lib/hooks";
import type { AnalyticsSummary } from "../../lib/types";
import "./workspace.css";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function toneFor(status: string) {
  if (status === "won" || status === "published") return "active" as const;
  if (status === "measuring" || status === "queued")
    return "processing" as const;
  if (status === "failed") return "failed" as const;
  return "idle" as const;
}

export function AnalyticsPage() {
  const { simulation } = useDataMode();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setData(await api.getAnalytics());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [simulation]);

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Experiment performance</p>
          <h1 className="page-title">Analytics</h1>
        </div>
        <div className="mode-toggle">
          <Button variant="ghost" disabled={busy} onClick={() => void load()}>
            Refresh
          </Button>
          <Link to="/app">
            <Button variant="accent">Ask agent</Button>
          </Link>
        </div>
      </header>

      <p className="page-lead">
        Metrics and winners from experiments (Zernio when connected). The{" "}
        <Link to="/app">Chat</Link> agent can pull this via{" "}
        <code>get_analytics</code> with RAG / markdown context.
      </p>

      {simulation ? (
        <p className="info-banner">
          <Badge tone="processing">Simulation</Badge> Demo metrics. Enable real
          data + Zernio in Settings for live ingest.
        </p>
      ) : (
        <p className="info-banner">
          <Badge tone="active">Real data</Badge> Live experiment list + KB
          experiment history. Full Zernio series appear after publish windows.
        </p>
      )}

      {error ? <p className="error-banner">{error}</p> : null}

      {data ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Summary</h2>
              <span className="panel-meta">
                {data.inconclusive ? "inconclusive" : "ready"} ·{" "}
                {new Date(data.updatedAt).toLocaleString()}
              </span>
            </div>
            <p className="list-row-body">{data.summary}</p>
            {data.winnerId ? (
              <p className="panel-meta">Winner · {data.winnerId}</p>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Experiments</h2>
              <span className="panel-meta">{data.rows.length} rows</span>
            </div>
            {data.rows.length === 0 ? (
              <p className="empty-state">
                No analytics rows yet. Publish variants, then ask Chat for a
                performance read.
              </p>
            ) : (
              <ul className="list-stack">
                {data.rows.map((row) => (
                  <li key={row.id} className="list-row">
                    <div className="list-row-main">
                      <div className="list-row-title">
                        <span>{row.title}</span>
                        <Badge tone={toneFor(row.status)}>{row.status}</Badge>
                        <Badge tone="idle">{row.platform}</Badge>
                        {row.winner ? (
                          <Badge tone="active">winner</Badge>
                        ) : null}
                      </div>
                      <p className="list-row-body">
                        <strong>Hook:</strong> {row.hook}
                      </p>
                      <p className="panel-meta">
                        impressions {row.impressions.toLocaleString()} · ER{" "}
                        {pct(row.engagementRate)} · CTR {pct(row.ctr)} · saves{" "}
                        {row.saves} · shares {row.shares} · comments{" "}
                        {row.comments}
                      </p>
                      {row.note ? (
                        <p className="list-row-body">{row.note}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="empty-state">{busy ? "Loading analytics…" : "No data."}</p>
      )}
    </div>
  );
}
