import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Progress } from "../../components/ui/Progress";
import { CarouselCardGrid } from "../../components/open-carousel/CarouselCardGrid";
import { ParsedOutput } from "../../components/workspace/ParsedOutput";
import { WorkflowStagesPanel } from "../../components/workspace/WorkflowStagesPanel";
import { DEMO_QUEUED_CAROUSELS } from "../../data/demo";
import { api } from "../../lib/api";
import {
  useAsyncAction,
  useDataMode,
  useLiveStatusError,
  useWorkflowStatus,
} from "../../lib/hooks";
import {
  fetchOpenCarousels,
  openCarouselEditorUrl,
  type OpenCarouselItem,
} from "../../lib/open-carousel";
import { loadSettings } from "../../lib/settings";
import type { HypothesisCard, RoadmapSummary } from "../../lib/types";
import "./workspace.css";

function statusTone(status: HypothesisCard["status"]) {
  if (status === "won" || status === "published") return "active" as const;
  if (status === "measuring" || status === "queued" || status === "active")
    return "processing" as const;
  if (status === "failed") return "failed" as const;
  return "idle" as const;
}

export function TestingPlanPage() {
  const { simulation } = useDataMode();
  const workflowStatus = useWorkflowStatus();
  const liveError = useLiveStatusError();
  const { busy, error: actionError, run, clearError } = useAsyncAction();
  const [roadmap, setRoadmap] = useState<RoadmapSummary | null>(null);
  const [roadmapText, setRoadmapText] = useState<string | null>(null);
  const [hypotheses, setHypotheses] = useState<HypothesisCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kickMsg, setKickMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [queued, setQueued] = useState<OpenCarouselItem[]>([]);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .getTestingPlan()
      .then((plan) => {
        if (cancelled) return;
        setRoadmap(plan.roadmap);
        setRoadmapText(plan.roadmapText);
        setHypotheses(plan.hypotheses);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    simulation,
    reloadKey,
    workflowStatus.currentStage,
    // Re-load plan when stage statuses change (e.g. after Run / kickstart).
    workflowStatus.stages.map((s) => `${s.stage}:${s.status}`).join("|"),
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadQueue() {
      setQueueBusy(true);
      if (simulation) {
        if (!cancelled) {
          setQueued(DEMO_QUEUED_CAROUSELS);
          setQueueMsg("Simulation · demo Open Carrusel queue");
          setQueueBusy(false);
        }
        return;
      }
      const baseUrl = loadSettings().openCarouselBaseUrl;
      const result = await fetchOpenCarousels(baseUrl);
      if (cancelled) return;
      setQueued(
        result.carousels.map((c) => ({
          ...c,
          status: c.status ?? "queued",
        })),
      );
      setQueueMsg(result.message);
      setQueueBusy(false);
    }
    void loadQueue();
    return () => {
      cancelled = true;
    };
  }, [simulation, reloadKey]);

  function openCarousel(item: OpenCarouselItem) {
    const baseUrl = loadSettings().openCarouselBaseUrl;
    if (item.id.startsWith("demo-")) {
      window.open(
        baseUrl.replace(/\/$/, "") || "http://localhost:3000",
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    window.open(
      openCarouselEditorUrl(baseUrl, item.id),
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function onKickstart() {
    clearError();
    setKickMsg(null);
    await run(async () => {
      await api.kickstartPlan();
      setKickMsg(
        simulation
          ? "Plan regenerated — roadmap and hypotheses ready. Ask Chat to review or approve."
          : "Workflow started — ask Chat when stages need approval.",
      );
      reload();
    });
  }

  const hasPlan = Boolean(roadmap || roadmapText || hypotheses.length > 0);
  const displayError = error ?? actionError ?? liveError;
  const processing = workflowStatus.stages.some(
    (s) => s.status === "in_progress" || s.status === "awaiting_approval",
  );

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Experiment design</p>
          <h1 className="page-title">Testing plan</h1>
        </div>
        <div className="mode-toggle">
          {!simulation ? (
            <>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.runWorkflow();
                    reload();
                  })
                }
              >
                Run workflow
              </Button>
              <Button
                variant={
                  workflowStatus.mode === "Full_Auto_Mode" ? "accent" : "ghost"
                }
                disabled={busy}
                onClick={() => run(() => api.setMode("Full_Auto_Mode"))}
              >
                Full auto
              </Button>
            </>
          ) : null}
          <Button
            variant="accent"
            disabled={busy}
            onClick={() => void onKickstart()}
          >
            {hasPlan ? "Regenerate plan" : "Generate plan"}
          </Button>
        </div>
      </header>

      <p className="page-lead">
        Kickstart a roadmap and hypotheses here — or ask{" "}
        <Link to="/app">Chat</Link> to generate and approve stages. Workflow
        progress below mirrors the full Overview stage rail.
      </p>

      <Progress
        active={busy || processing}
        label="Agents advancing the experiment loop"
      />

      <WorkflowStagesPanel status={workflowStatus} />

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Kickstart</h2>
          <Badge tone={simulation ? "processing" : "active"}>
            {simulation ? "Simulation" : "Real"}
          </Badge>
        </div>
        <p className="page-lead" style={{ marginBottom: "var(--space-md)" }}>
          {simulation
            ? "Reset the demo roadmap and hypothesis set for review."
            : "Run the agent pipeline to produce a testing plan from your knowledge base. Configure Firecrawl / LLM under Settings first."}
        </p>
        <div className="list-row-actions">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void onKickstart()}
          >
            {busy ? "Generating…" : "Kickstart plan"}
          </Button>
          {hasPlan ? (
            <Button variant="ghost" disabled={busy} onClick={reload}>
              Refresh
            </Button>
          ) : null}
        </div>
        <Progress active={busy} label="Generating testing plan" />
        {kickMsg ? <p className="info-banner">{kickMsg}</p> : null}
      </section>

      {displayError ? <p className="error-banner">{displayError}</p> : null}

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{roadmap?.title ?? "Roadmap"}</h2>
          <span className="panel-meta">
            {roadmap ? `${roadmap.weeks.length} weeks` : "plan"}
          </span>
        </div>
        {roadmap ? (
          <>
            <p className="page-lead" style={{ marginBottom: "var(--space-md)" }}>
              {roadmap.summary}
            </p>
            <ul className="stage-rail">
              {roadmap.weeks.map((w) => (
                <li key={w.week} className="stage-item">
                  <div className="stage-top">
                    <span className="stage-name">
                      Week {w.week} · {w.theme}
                    </span>
                  </div>
                  <p className="list-row-body">{w.objective}</p>
                </li>
              ))}
            </ul>
          </>
        ) : roadmapText ? (
          <ParsedOutput raw={roadmapText} stage="RoadmapReview" />
        ) : (
          <p className="empty-state">
            No roadmap yet. Press <strong>Kickstart plan</strong> to generate
            one
            {!simulation ? (
              <>
                , or ask <Link to="/app">Chat</Link> after the workflow advances
              </>
            ) : null}
            .
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Hypotheses</h2>
          <span className="panel-meta">{hypotheses.length} active</span>
        </div>
        {hypotheses.length === 0 ? (
          <p className="empty-state">
            No hypotheses yet. Kickstart a plan, then approve the roadmap via{" "}
            <Link to="/app">Chat</Link>.
          </p>
        ) : (
          <ul className="list-stack">
            {hypotheses.map((h) => (
              <li key={h.id} className="list-row">
                <div className="list-row-main">
                  <div className="list-row-title">
                    <span>{h.title ?? h.hook}</span>
                    <Badge tone={statusTone(h.status)}>{h.status}</Badge>
                    <Badge tone="idle">{h.platform}</Badge>
                  </div>
                  {h.title ? (
                    <p className="list-row-body">
                      <strong>Hook:</strong> {h.hook}
                    </p>
                  ) : null}
                  {h.angle ? (
                    <p className="list-row-body">{h.angle}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Queued carousels</h2>
          <span className="panel-meta">
            {queueBusy ? "loading…" : `${queued.length} in queue`}
          </span>
        </div>
        <p className="page-lead" style={{ marginBottom: "var(--space-md)" }}>
          Open Carrusel decks ready to ship. Same slide preview cards as the
          studio — click to open in Open Carrusel.
        </p>
        {queueMsg ? <p className="panel-meta">{queueMsg}</p> : null}
        <Progress active={queueBusy} label="Loading Open Carrusel queue" />
        <CarouselCardGrid
          carousels={queued}
          onOpen={openCarousel}
          emptyLabel={
            simulation
              ? "No queued carousels in the demo set."
              : "No carousels in Open Carrusel yet. Kickstart the plan or create decks in the studio."
          }
        />
      </section>
    </div>
  );
}
