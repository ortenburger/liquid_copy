import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CarouselCardGrid } from "../../components/open-carousel/CarouselCardGrid";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Progress } from "../../components/ui/Progress";
import { api } from "../../lib/api";
import {
  useAsyncAction,
  useDataMode,
  useLiveStatusError,
  useWorkflowStatus,
} from "../../lib/hooks";
import {
  openCarouselEditorUrl,
  type OpenCarouselItem,
} from "../../lib/open-carousel";
import { loadSettings } from "../../lib/settings";
import type {
  HypothesisCard,
  WeekPostingPlan,
} from "../../lib/types";
import "./workspace.css";

function statusTone(status: HypothesisCard["status"]) {
  if (status === "won" || status === "published") return "active" as const;
  if (status === "measuring" || status === "queued" || status === "active")
    return "processing" as const;
  if (status === "failed") return "failed" as const;
  return "idle" as const;
}

function statusLabel(status: HypothesisCard["status"]) {
  if (status === "draft_review") return "ready to review";
  if (status === "active") return "ready to test";
  return status.replace(/_/g, " ");
}

function formatSlotWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function TestingPlanPage() {
  const { simulation } = useDataMode();
  const workflowStatus = useWorkflowStatus();
  const liveError = useLiveStatusError();
  const { busy, error: actionError, run, clearError } = useAsyncAction();
  const [hypotheses, setHypotheses] = useState<HypothesisCard[]>([]);
  const [weekPlan, setWeekPlan] = useState<WeekPostingPlan | null>(null);
  const [planCarousels, setPlanCarousels] = useState<OpenCarouselItem[]>([]);
  const [planMarkdown, setPlanMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState("Updating testing plan");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [plan, central] = await Promise.all([
          api.getTestingPlan(),
          api.getCentralPlanDocument(),
        ]);
        if (cancelled) return;
        setHypotheses(plan.hypotheses);
        setWeekPlan(central.plan);
        setPlanCarousels(central.carousels);
        setPlanMarkdown(central.markdown);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    simulation,
    reloadKey,
    workflowStatus.currentStage,
    workflowStatus.stages.map((s) => `${s.stage}:${s.status}`).join("|"),
  ]);

  const carouselById = useMemo(() => {
    const map = new Map<string, OpenCarouselItem>();
    for (const c of planCarousels) map.set(c.id, c);
    return map;
  }, [planCarousels]);

  async function onBuildWeekPlan() {
    clearError();
    setMsg(null);
    setProgressLabel("Building week plan");
    await run(async () => {
      const result = await api.generateWeekPostingPlan({
        onProgress: (m) => setProgressLabel(m),
      });
      setHypotheses(result.hypotheses);
      setWeekPlan(result.plan);
      setPlanCarousels(result.carousels);
      setPlanMarkdown(result.markdown);
      setMsg(
        `Week plan ready — ${result.plan.slots.length} carousel${result.plan.slots.length === 1 ? "" : "s"} saved to testing-plan.md.`,
      );
      setProgressLabel("Updating testing plan");
    });
  }

  async function onKickstartHypotheses() {
    clearError();
    setMsg(null);
    setProgressLabel("Loading hypotheses");
    await run(async () => {
      await api.kickstartPlan();
      setMsg(
        simulation
          ? "Hypotheses refreshed from demo plan."
          : "Workflow started — hypotheses will appear as stages complete.",
      );
      reload();
    });
  }

  async function onQueueAllToZernio() {
    clearError();
    setMsg(null);
    setProgressLabel("Queuing carousels to Zernio");
    await run(async () => {
      const result = await api.queueWeekPlanToZernio({
        onProgress: (m) => setProgressLabel(m),
      });
      setPlanCarousels(result.carousels);
      setMsg(result.message);
      if (!result.ok) {
        setError(
          `${result.failed} carousel${result.failed === 1 ? "" : "s"} failed — check Settings / Zernio key, or retry.`,
        );
      }
      setProgressLabel("Updating testing plan");
    });
  }

  function openStudio(carousel: OpenCarouselItem) {
    if (simulation || carousel.id.startsWith("demo-oc-")) {
      setMsg(`Demo carousel “${carousel.name}” — switch to Live + Open Carrusel to edit.`);
      return;
    }
    const url = openCarouselEditorUrl(
      loadSettings().openCarouselBaseUrl,
      carousel.id,
    );
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const hasHypotheses = hypotheses.length > 0;
  const hasWeekSlots = Boolean(weekPlan && weekPlan.slots.length > 0);
  const pendingZernioCount = planCarousels.filter(
    (c) => c.status !== "published" && c.status !== "publishing",
  ).length;
  const displayError = error ?? actionError ?? liveError;

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">One week of tests</p>
          <h1 className="page-title">Plan</h1>
        </div>
        <div className="mode-toggle">
          <Badge tone={simulation ? "processing" : "active"}>
            {simulation ? "Simulation" : "Live"}
          </Badge>
          <Button
            variant="accent"
            disabled={busy || !hasHypotheses}
            onClick={() => void onBuildWeekPlan()}
          >
            {hasWeekSlots ? "Rebuild week plan" : "Plan this week"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void onKickstartHypotheses()}
          >
            {hasHypotheses ? "Refresh hypotheses" : "Load hypotheses"}
          </Button>
          {hasHypotheses || planMarkdown || hasWeekSlots ? (
            <Button variant="ghost" disabled={busy} onClick={reload}>
              Refresh
            </Button>
          ) : null}
        </div>
      </header>

      <p className="page-lead">
        One central plan lives as <code>testing-plan.md</code> in the knowledge
        base. Building the week plan rewrites that document, generates a
        carousel per hypothesis, and lets you queue everything to Zernio.
      </p>

      <Progress active={busy} label={progressLabel} />
      {msg ? <p className="info-banner">{msg}</p> : null}
      {displayError ? <p className="error-banner">{displayError}</p> : null}

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Central plan document</h2>
          <span className="panel-meta">testing-plan.md</span>
        </div>
        {planMarkdown ? (
          <pre className="checkpoint-output" style={{ maxHeight: 320 }}>
            {planMarkdown}
          </pre>
        ) : (
          <p className="empty-state">
            No <code>testing-plan.md</code> yet. Load hypotheses, then{" "}
            <strong>Plan this week</strong> to create it.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Hypotheses to test</h2>
          <span className="panel-meta">{hypotheses.length} total</span>
        </div>
        {hypotheses.length === 0 ? (
          <p className="empty-state">
            No hypotheses yet. Press <strong>Load hypotheses</strong>
            {!simulation ? (
              <>
                {" "}
                or ask <Link to="/app">Chat</Link> after the workflow advances
              </>
            ) : null}
            .
          </p>
        ) : (
          <ul className="list-stack">
            {hypotheses.map((h) => (
              <li key={h.id} className="list-row">
                <div className="list-row-main">
                  <div className="list-row-title">
                    <span>{h.title ?? h.hook}</span>
                    <Badge tone={statusTone(h.status)}>
                      {statusLabel(h.status)}
                    </Badge>
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
          <h2 className="panel-title">This week&apos;s posting plan</h2>
          <span className="panel-meta">
            {hasWeekSlots
              ? `${weekPlan!.slots.length} post${weekPlan!.slots.length === 1 ? "" : "s"}`
              : "not built"}
          </span>
        </div>
        {hasWeekSlots && weekPlan ? (
          <>
            <p className="page-lead" style={{ marginBottom: "var(--space-md)" }}>
              {weekPlan.summary}
            </p>
            <div className="list-row-actions" style={{ marginBottom: "var(--space-md)" }}>
              <Button
                variant="accent"
                disabled={busy || pendingZernioCount === 0}
                onClick={() => void onQueueAllToZernio()}
              >
                {busy && progressLabel.toLowerCase().includes("zernio")
                  ? "Queuing…"
                  : pendingZernioCount === 0
                    ? "All queued in Zernio"
                    : simulation
                      ? `Simulate all in Zernio (${pendingZernioCount})`
                      : `Queue all in Zernio (${pendingZernioCount})`}
              </Button>
            </div>
            <ol className="posting-plan" aria-label="Week posting plan">
              {weekPlan.slots.map((slot) => {
                const carousel = carouselById.get(slot.carouselId);
                return (
                  <li key={slot.id} className="posting-plan-slot">
                    <div className="posting-plan-slot-head">
                      <div className="list-row-title">
                        <Badge tone="processing">{slot.dayLabel}</Badge>
                        <span>{slot.hypothesisTitle}</span>
                        <Badge tone="idle">{slot.platform}</Badge>
                      </div>
                      <p className="list-row-body">
                        {formatSlotWhen(slot.scheduledAt)} · {slot.hook}
                      </p>
                    </div>
                    {carousel ? (
                      <CarouselCardGrid
                        carousels={[carousel]}
                        onOpen={openStudio}
                        emptyLabel="Carousel missing — rebuild the week plan."
                      />
                    ) : (
                      <p className="empty-state">
                        Carousel missing for this hypothesis. Rebuild the week
                        plan.
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="empty-state">
            {hasHypotheses ? (
              <>
                Press <strong>Plan this week</strong> to schedule hypotheses and
                generate one carousel each.
              </>
            ) : (
              <>Load hypotheses first, then build the week plan.</>
            )}
          </p>
        )}
      </section>
    </div>
  );
}
