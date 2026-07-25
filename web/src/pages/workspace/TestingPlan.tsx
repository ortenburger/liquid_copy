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
} from "../../lib/hooks";
import {
  openCarouselEditorUrl,
  type OpenCarouselItem,
} from "../../lib/open-carousel";
import { loadSettings } from "../../lib/settings";
import type {
  HypothesisCard,
  RoadmapSummary,
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
  const liveError = useLiveStatusError();
  const { busy, error: actionError, run, clearError } = useAsyncAction();
  const [roadmap, setRoadmap] = useState<RoadmapSummary | null>(null);
  const [hypotheses, setHypotheses] = useState<HypothesisCard[]>([]);
  const [weekPlan, setWeekPlan] = useState<WeekPostingPlan | null>(null);
  const [carousels, setCarousels] = useState<OpenCarouselItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState("Updating plan");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [plan, week] = await Promise.all([
          api.getTestingPlan(),
          Promise.resolve(api.getWeekPostingPlan()),
        ]);
        if (cancelled) return;
        setRoadmap(plan.roadmap);
        setHypotheses(plan.hypotheses);
        setWeekPlan(week.plan);
        setCarousels(week.carousels);
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
  }, [simulation, reloadKey]);

  const carouselById = useMemo(() => {
    const map = new Map<string, OpenCarouselItem>();
    for (const c of carousels) map.set(c.id, c);
    return map;
  }, [carousels]);

  async function onGenerate() {
    clearError();
    setMsg(null);
    await run(async () => {
      if (simulation) {
        setProgressLabel("Loading demo plan…");
        await api.kickstartPlan();
        setProgressLabel("Building 7-day carousels…");
        const result = await api.generateWeekPostingPlan({
          startFrom: "today",
          onProgress: setProgressLabel,
        });
        setRoadmap({
          title: "Next 7 days",
          summary: result.plan.summary,
          weeks: result.hypotheses.map((h, i) => ({
            week: i + 1,
            theme: h.title ?? h.hook.slice(0, 48),
            objective: [h.hook, h.angle].filter(Boolean).join(" — "),
          })),
        });
        setHypotheses(result.hypotheses);
        setWeekPlan(result.plan);
        setCarousels(result.carousels);
        setMsg(
          `Demo plan ready — ${result.plan.slots.length} hypotheses + carousels for the next 7 days.`,
        );
      } else {
        setProgressLabel("Generating from RAG + Ollama…");
        const result = await api.generateSevenDayPlan({
          onProgress: setProgressLabel,
        });
        setRoadmap(result.roadmap);
        setHypotheses(result.hypotheses);
        setWeekPlan(result.plan);
        setCarousels(result.carousels);
        setMsg(
          `7-day plan ready — ${result.hypotheses.length} RAG/Ollama hypotheses, one carousel each.`,
        );
      }
      setProgressLabel("Updating plan");
    });
  }

  function openStudio(carousel: OpenCarouselItem) {
    if (simulation || carousel.id.startsWith("demo-oc-")) {
      setMsg(
        `Demo carousel “${carousel.name}” — switch to Live + Open Carrusel to edit.`,
      );
      return;
    }
    window.open(
      openCarouselEditorUrl(loadSettings().openCarouselBaseUrl, carousel.id),
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function onQueueAllToZernio() {
    clearError();
    setMsg(null);
    await run(async () => {
      setProgressLabel("Queuing all carousels to Zernio…");
      const result = await api.queueWeekPlanToZernio({
        onProgress: setProgressLabel,
      });
      setCarousels(result.carousels);
      setMsg(result.message);
      if (!result.ok) {
        setError(
          `${result.failed} carousel${result.failed === 1 ? "" : "s"} failed — check Settings / Zernio key, or retry.`,
        );
      }
      setProgressLabel("Updating plan");
    });
  }

  const hasPlan = Boolean(
    roadmap || hypotheses.length > 0 || (weekPlan && weekPlan.slots.length > 0),
  );
  const pendingZernioCount = carousels.filter(
    (c) => c.status !== "published" && c.status !== "publishing",
  ).length;
  const hasWeekSlots = Boolean(weekPlan && weekPlan.slots.length > 0);
  const displayError = error ?? actionError ?? liveError;

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Next 7 days</p>
          <h1 className="page-title">Plan</h1>
        </div>
        <div className="mode-toggle">
          <Badge tone={simulation ? "processing" : "active"}>
            {simulation ? "Simulation" : "Live"}
          </Badge>
          <Button
            variant="accent"
            disabled={busy}
            onClick={() => void onGenerate()}
          >
            {hasPlan ? "Regenerate" : "Generate plan"}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !hasWeekSlots || pendingZernioCount === 0}
            onClick={() => void onQueueAllToZernio()}
          >
            {pendingZernioCount === 0 && hasWeekSlots
              ? "All queued"
              : `Queue all to Zernio${hasWeekSlots ? ` (${pendingZernioCount})` : ""}`}
          </Button>
          {hasPlan ? (
            <Button variant="ghost" disabled={busy} onClick={reload}>
              Refresh
            </Button>
          ) : null}
        </div>
      </header>

      <p className="page-lead">
        {simulation
          ? "Demo mode loads sample hypotheses and carousels for the next 7 days."
          : "Live mode pulls RAG/KB context, drafts 7 hypotheses with your LLM (Ollama), and builds one carousel per day."}{" "}
        Ask <Link to="/app">Chat</Link> to refine.
      </p>

      <Progress active={busy} label={progressLabel} />
      {msg ? <p className="info-banner">{msg}</p> : null}
      {displayError ? <p className="error-banner">{displayError}</p> : null}

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{roadmap?.title ?? "Roadmap · 7 days"}</h2>
          <span className="panel-meta">
            {roadmap ? `${roadmap.weeks.length} days` : "pending"}
          </span>
        </div>
        {roadmap ? (
          <>
            <p className="page-lead" style={{ marginBottom: "var(--space-md)" }}>
              {roadmap.summary}
            </p>
            <ol className="stage-rail" aria-label="Seven-day roadmap">
              {roadmap.weeks.map((w) => (
                <li key={w.week} className="stage-item">
                  <div className="stage-top">
                    <span className="stage-index" aria-hidden>
                      {String(w.week).padStart(2, "0")}
                    </span>
                    <span className="stage-name">{w.theme}</span>
                    <Badge tone="idle">Day {w.week}</Badge>
                  </div>
                  <p className="stage-summary">{w.objective}</p>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="empty-state">
            No roadmap yet. Press <strong>Generate plan</strong>
            {!simulation ? " (needs KB/RAG + Ollama)" : null}.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Hypotheses to test</h2>
          <span className="panel-meta">{hypotheses.length}</span>
        </div>
        {hypotheses.length === 0 ? (
          <p className="empty-state">
            No hypotheses yet. Generate a plan to draft the next 7 days.
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
          <h2 className="panel-title">Carousels · next 7 days</h2>
          <span className="panel-meta">
            {weekPlan?.slots.length
              ? `${weekPlan.slots.length} scheduled`
              : "not built"}
          </span>
        </div>
        {weekPlan && weekPlan.slots.length > 0 ? (
          <>
            <p className="page-lead" style={{ marginBottom: "var(--space-md)" }}>
              {weekPlan.summary}
            </p>
            <div
              className="list-row-actions"
              style={{ marginBottom: "var(--space-md)" }}
            >
              <Button
                variant="accent"
                disabled={busy || pendingZernioCount === 0}
                onClick={() => void onQueueAllToZernio()}
              >
                {busy && progressLabel.toLowerCase().includes("zernio")
                  ? "Queuing…"
                  : pendingZernioCount === 0
                    ? "All queued in Zernio"
                    : `Queue all to Zernio (${pendingZernioCount})`}
              </Button>
            </div>
            <ol className="posting-plan" aria-label="Seven-day carousel plan">
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
                        emptyLabel="Carousel missing — regenerate the plan."
                      />
                    ) : (
                      <p className="empty-state">
                        Carousel missing for this hypothesis. Regenerate the
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
            Generate a plan to create one carousel per hypothesis for the next 7
            days
            {!simulation ? " (Open Carrusel must be running)" : null}.
          </p>
        )}
      </section>
    </div>
  );
}
