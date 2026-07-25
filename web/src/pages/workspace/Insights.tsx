import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { useDataMode } from "../../lib/hooks";
import type {
  AnalyticsRow,
  AnalyticsSummary,
  HypothesisCard,
} from "../../lib/types";
import "./workspace.css";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function rankScore(row: AnalyticsRow) {
  // Prefer engagement; break ties with reach.
  return row.engagementRate * 1000 + row.impressions / 1_000_000;
}

function toneFor(status: string) {
  if (status === "won" || status === "published") return "active" as const;
  if (status === "measuring" || status === "queued")
    return "processing" as const;
  if (status === "failed") return "failed" as const;
  return "idle" as const;
}

export function InsightsPage() {
  const { simulation } = useDataMode();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const analytics = await api.getAnalytics();
      // Enrich angles from current hypotheses when analytics rows lack them.
      const { hypotheses } = await api.getTestingPlan().catch(() => ({
        hypotheses: [] as HypothesisCard[],
      }));
      const byHook = new Map(
        hypotheses.map((h) => [h.hook.trim().toLowerCase(), h.angle]),
      );
      setData({
        ...analytics,
        rows: analytics.rows.map((row) => ({
          ...row,
          angle:
            row.angle ||
            byHook.get(row.hook.trim().toLowerCase()) ||
            undefined,
        })),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [simulation]);

  const ranked = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => rankScore(b) - rankScore(a));
  }, [data]);

  const topHooks = ranked.filter((r) => r.status !== "failed").slice(0, 5);
  const topAngles = ranked
    .filter((r) => r.angle && r.status !== "failed")
    .slice(0, 5);
  const underperformers = ranked
    .filter((r) => r.status === "failed" || r.engagementRate < 0.02)
    .slice(0, 3);

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">What&apos;s working</p>
          <h1 className="page-title">Insights</h1>
        </div>
        <div className="mode-toggle">
          <Badge tone={simulation ? "processing" : "active"}>
            {simulation ? "Simulation" : "Live"}
          </Badge>
          <Button variant="ghost" disabled={busy} onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </header>

      <p className="page-lead">
        Top-performing hooks and angles from published tests. Use these to
        steer the next week on{" "}
        <Link to="/app/testing-plan">Plan</Link>.
      </p>

      {error ? <p className="error-banner">{error}</p> : null}

      {data ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Readout</h2>
              <span className="panel-meta">
                {data.inconclusive ? "inconclusive" : "ready"} ·{" "}
                {new Date(data.updatedAt).toLocaleString()}
              </span>
            </div>
            <p className="list-row-body">{data.summary}</p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Top hooks</h2>
              <span className="panel-meta">{topHooks.length} ranked</span>
            </div>
            {topHooks.length === 0 ? (
              <p className="empty-state">
                No hook performance yet. Queue a week from Plan, publish via
                Zernio, then refresh.
              </p>
            ) : (
              <ol className="list-stack insights-rank">
                {topHooks.map((row, i) => (
                  <li key={`hook-${row.id}`} className="list-row">
                    <div className="list-row-main">
                      <div className="list-row-title">
                        <span className="insights-rank-index" aria-hidden>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{row.hook}</span>
                        {row.winner ? (
                          <Badge tone="active">winner</Badge>
                        ) : null}
                        <Badge tone={toneFor(row.status)}>{row.status}</Badge>
                        <Badge tone="idle">{row.platform}</Badge>
                      </div>
                      <p className="panel-meta">
                        ER {pct(row.engagementRate)} ·{" "}
                        {row.impressions.toLocaleString()} impressions · CTR{" "}
                        {pct(row.ctr)} · {row.saves} saves
                      </p>
                      {row.note ? (
                        <p className="list-row-body">{row.note}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Top angles</h2>
              <span className="panel-meta">{topAngles.length} ranked</span>
            </div>
            {topAngles.length === 0 ? (
              <p className="empty-state">
                No angles linked to performance yet. Angles come from
                hypotheses once tests have metrics.
              </p>
            ) : (
              <ol className="list-stack insights-rank">
                {topAngles.map((row, i) => (
                  <li key={`angle-${row.id}`} className="list-row">
                    <div className="list-row-main">
                      <div className="list-row-title">
                        <span className="insights-rank-index" aria-hidden>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{row.angle}</span>
                        {row.winner ? (
                          <Badge tone="active">winner</Badge>
                        ) : null}
                        <Badge tone="idle">{row.platform}</Badge>
                      </div>
                      <p className="list-row-body">
                        <strong>Hook:</strong> {row.hook}
                      </p>
                      <p className="panel-meta">
                        ER {pct(row.engagementRate)} ·{" "}
                        {row.impressions.toLocaleString()} impressions
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {underperformers.length > 0 ? (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Avoid / revisit</h2>
                <span className="panel-meta">{underperformers.length}</span>
              </div>
              <ul className="list-stack">
                {underperformers.map((row) => (
                  <li key={`low-${row.id}`} className="list-row">
                    <div className="list-row-main">
                      <div className="list-row-title">
                        <span>{row.hook}</span>
                        <Badge tone={toneFor(row.status)}>{row.status}</Badge>
                      </div>
                      {row.angle ? (
                        <p className="list-row-body">
                          <strong>Angle:</strong> {row.angle}
                        </p>
                      ) : null}
                      <p className="panel-meta">
                        ER {pct(row.engagementRate)}
                        {row.note ? ` · ${row.note}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <p className="empty-state">
          {busy ? "Loading insights…" : "No performance data yet."}
        </p>
      )}
    </div>
  );
}
