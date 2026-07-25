import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import { Button } from "../../components/ui/Button";
import { Progress } from "../../components/ui/Progress";
import { api } from "../../lib/api";
import { useDataMode } from "../../lib/hooks";
import {
  loadInsightsAnalysis,
  loadInsightsExtract,
} from "../../lib/insights-analysis-store";
import type { AnalyticsRow, AnalyticsSummary } from "../../lib/types";
import "./workspace.css";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function rankScore(row: AnalyticsRow) {
  return row.engagementRate * 1000 + row.impressions / 1_000_000;
}

function AnalysisBlock({
  label,
  markdown,
}: {
  label: string;
  markdown: string;
}) {
  return (
    <section className="insights-analysis" aria-label={label}>
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </Markdown>
    </section>
  );
}

export function InsightsPage() {
  const { simulation } = useDataMode();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(
    () => loadInsightsAnalysis()?.markdown ?? null,
  );
  const [extract, setExtract] = useState<string | null>(
    () => loadInsightsExtract()?.markdown ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [progressLabel, setProgressLabel] = useState("Working");

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setData(await api.getAnalytics());
      const cachedAnalysis = loadInsightsAnalysis();
      if (cachedAnalysis) setAnalysis(cachedAnalysis.markdown);
      const cachedExtract = loadInsightsExtract();
      if (cachedExtract) setExtract(cachedExtract.markdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [simulation]);

  async function onAnalyze() {
    setWorking(true);
    setError(null);
    setProgressLabel("Analyzing…");
    try {
      const result = await api.analyzeInsights({
        onProgress: setProgressLabel,
      });
      setAnalysis(result.markdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  async function onExtractPerformers() {
    setWorking(true);
    setError(null);
    setProgressLabel("Extracting winners…");
    try {
      const result = await api.extractPerformingInsights({
        analysisMarkdown: analysis ?? undefined,
        onProgress: setProgressLabel,
      });
      setExtract(result.markdown);
      const cached = loadInsightsAnalysis();
      if (cached) setAnalysis(cached.markdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  const ranked = useMemo(() => {
    if (!data) return [];
    return [...data.rows]
      .filter((r) => r.status !== "failed")
      .sort((a, b) => rankScore(b) - rankScore(a))
      .slice(0, 8);
  }, [data]);

  const actionBusy = busy || working;

  return (
    <div className="page insights-simple stagger-in">
      <header className="plan-simple-head">
        <h1 className="page-title">Insights</h1>
        <div className="plan-simple-actions">
          <Button
            variant="accent"
            disabled={actionBusy}
            onClick={() => void onAnalyze()}
          >
            {analysis ? "Re-analyze" : "Analyze"}
          </Button>
          <Button
            variant="ghost"
            disabled={actionBusy}
            onClick={() => void onExtractPerformers()}
          >
            Extract winners
          </Button>
        </div>
      </header>

      <Progress active={working} label={progressLabel} />
      {error ? <p className="error-banner">{error}</p> : null}

      {extract ? (
        <AnalysisBlock label="Performing copy and angles" markdown={extract} />
      ) : null}

      {analysis ? (
        <AnalysisBlock label="Insights analysis" markdown={analysis} />
      ) : null}

      {busy && !data ? (
        <p className="empty-state">Loading…</p>
      ) : ranked.length === 0 ? (
        <p className="empty-state">
          {analysis || extract
            ? "No ranked hooks yet."
            : "No performance data yet."}
        </p>
      ) : (
        <ol className="insights-simple-list">
          {ranked.map((row, i) => (
            <li key={row.id} className="insights-simple-row">
              <span className="insights-simple-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="insights-simple-copy">
                <p className="insights-simple-hook">{row.hook}</p>
                {row.angle ? (
                  <p className="insights-simple-angle">{row.angle}</p>
                ) : null}
              </div>
              <span className="insights-simple-er">{pct(row.engagementRate)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
