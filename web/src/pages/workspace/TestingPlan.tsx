import { useCallback, useEffect, useMemo, useState } from "react";
import { SlideRenderer } from "../../components/open-carousel/SlideRenderer";
import { Button } from "../../components/ui/Button";
import { Progress } from "../../components/ui/Progress";
import { api } from "../../lib/api";
import { listQueuedCarousels } from "../../lib/carousel-queue-store";
import { useAsyncAction, useDataMode, useLiveStatusError } from "../../lib/hooks";
import {
  openCarouselEditorUrl,
  type OpenCarouselItem,
} from "../../lib/open-carousel";
import { MAX_QUEUED_WEEKS } from "../../lib/posting-plan-store";
import { loadSettings } from "../../lib/settings";
import type { QueuedWeek, WeekQueue } from "../../lib/types";
import "./workspace.css";

type ZernioQueuePost = Awaited<
  ReturnType<typeof api.listZernioQueuedPosts>
>["posts"][number];

export function TestingPlanPage() {
  const { simulation } = useDataMode();
  const liveError = useLiveStatusError();
  const { busy, error: actionError, run, clearError } = useAsyncAction();
  const [queue, setQueue] = useState<WeekQueue>({ weeks: [], updatedAt: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [carousels, setCarousels] = useState<OpenCarouselItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState("Working");
  const [zernioPosts, setZernioPosts] = useState<ZernioQueuePost[]>([]);
  const [zernioMsg, setZernioMsg] = useState<string | null>(null);
  const [zernioLoading, setZernioLoading] = useState(false);

  function applyWeek(week: QueuedWeek | null, nextQueue?: WeekQueue) {
    if (nextQueue) setQueue(nextQueue);
    setSelectedId(week?.id ?? null);
    if (!week) {
      setCarousels([]);
      return;
    }
    const { carousels: next } = api.getWeekPostingPlan(week.id);
    setCarousels(next);
  }

  const refreshZernioQueue = useCallback(async () => {
    setZernioLoading(true);
    try {
      const result = await api.listZernioQueuedPosts();
      setZernioPosts(result.posts);
      setZernioMsg(result.ok ? null : result.message);
    } catch (e) {
      setZernioPosts([]);
      setZernioMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setZernioLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const { queue: q, selected, carousels: next } = api.getWeekQueue();
      setQueue(q);
      setSelectedId(selected?.id ?? null);
      setCarousels(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    void refreshZernioQueue();
  }, [simulation, refreshZernioQueue]);

  const selected = useMemo(() => {
    if (!selectedId) return queue.weeks[queue.weeks.length - 1] ?? null;
    return queue.weeks.find((w) => w.id === selectedId) ?? null;
  }, [queue.weeks, selectedId]);

  useEffect(() => {
    if (!selected) {
      setCarousels([]);
      return;
    }
    const { carousels: next } = api.getWeekPostingPlan(selected.id);
    setCarousels(next);
  }, [selected?.id]);

  const carouselById = useMemo(() => {
    const map = new Map<string, OpenCarouselItem>();
    for (const c of carousels) map.set(c.id, c);
    return map;
  }, [carousels]);

  async function onGenerateNextWeek() {
    clearError();
    await run(async () => {
      setProgressLabel("Generating next week…");
      const result = await api.analyzeInsightsAndPlanWeek({
        mode: "append",
        onProgress: setProgressLabel,
      });
      applyWeek(result.week, result.queue);
    });
  }

  async function onRebuild() {
    if (!selected) {
      await onGenerateNextWeek();
      return;
    }
    clearError();
    await run(async () => {
      setProgressLabel("Rebuilding week…");
      const result = await api.analyzeInsightsAndPlanWeek({
        mode: "replaceSelected",
        weekId: selected.id,
        onProgress: setProgressLabel,
      });
      applyWeek(result.week, result.queue);
    });
  }

  function onClear() {
    clearError();
    const cleared = api.clearWeekPlan(selected?.id);
    setQueue(cleared.queue);
    setSelectedId(cleared.selected?.id ?? null);
    setCarousels(cleared.carousels);
  }

  function openStudio(carousel: OpenCarouselItem) {
    if (simulation || carousel.id.startsWith("demo-oc-")) return;
    window.open(
      openCarouselEditorUrl(loadSettings().openCarouselBaseUrl, carousel.id),
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function onZernio() {
    if (!selected) return;
    clearError();
    await run(async () => {
      setProgressLabel("Queuing…");
      const result = await api.queueWeekPlanToZernio({
        weekId: selected.id,
        onProgress: setProgressLabel,
      });
      setCarousels(result.carousels);
      if (!result.ok) {
        setError(`${result.failed} failed — check Zernio in Settings.`);
      }
      await refreshZernioQueue();
    });
  }

  const slots = selected?.plan.slots ?? [];
  const hasPlan = slots.length > 0;
  const queueFull = queue.weeks.length >= MAX_QUEUED_WEEKS;
  const pending = carousels.filter(
    (c) => c.status !== "published" && c.status !== "publishing",
  ).length;
  const displayError = error ?? actionError ?? liveError;
  const localById = useMemo(() => {
    const map = new Map<string, OpenCarouselItem>();
    for (const c of listQueuedCarousels()) map.set(c.id, c);
    return map;
  }, [zernioPosts, carousels]);

  return (
    <div className="page plan-simple stagger-in">
      <header className="plan-simple-head">
        <h1 className="page-title">Plan</h1>
        <div className="plan-simple-actions">
          <Button
            variant="accent"
            disabled={busy || queueFull}
            onClick={() => void onGenerateNextWeek()}
          >
            {hasPlan ? "Next week" : "Plan week"}
          </Button>
          {hasPlan ? (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void onRebuild()}
              >
                Rebuild
              </Button>
              <Button
                variant="ghost"
                disabled={busy || pending === 0}
                onClick={() => void onZernio()}
              >
                {pending === 0 ? "Queued" : "Queue"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={onClear}>
                Clear
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {queue.weeks.length > 0 ? (
        <div className="plan-week-tabs" role="tablist" aria-label="Week plans">
          {queue.weeks.map((w) => (
            <button
              key={w.id}
              type="button"
              role="tab"
              aria-selected={w.id === selected?.id}
              className={`plan-week-tab ${w.id === selected?.id ? "is-active" : ""}`}
              onClick={() => setSelectedId(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
      ) : null}

      <Progress active={busy} label={progressLabel} />
      {displayError ? <p className="error-banner">{displayError}</p> : null}

      {!hasPlan ? (
        <p className="empty-state">No week plan yet.</p>
      ) : (
        <ol className="plan-simple-list">
          {slots.map((slot) => {
            const carousel = carouselById.get(slot.carouselId);
            const slide = carousel?.slides[0];
            return (
              <li key={slot.id} className="plan-simple-row">
                <div className="plan-simple-copy">
                  <span className="plan-simple-day">{slot.dayLabel}</span>
                  <p className="plan-simple-hook">{slot.hook}</p>
                </div>
                {carousel && slide?.html ? (
                  <button
                    type="button"
                    className="plan-simple-preview"
                    onClick={() => openStudio(carousel)}
                    aria-label={`Open ${carousel.name}`}
                  >
                    <SlideRenderer
                      html={slide.html}
                      aspectRatio={carousel.aspectRatio}
                      className="plan-simple-slide"
                    />
                  </button>
                ) : (
                  <div className="plan-simple-preview is-empty">—</div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <section className="zernio-queue" aria-label="Zernio queue">
        <header className="zernio-queue-head">
          <h2 className="zernio-queue-title">
            {simulation ? "Simulated queue" : "Zernio queue"}
          </h2>
          <Button
            variant="ghost"
            disabled={zernioLoading || busy}
            onClick={() => void refreshZernioQueue()}
          >
            {zernioLoading ? "Loading…" : "Refresh"}
          </Button>
        </header>
        {zernioMsg ? <p className="muted">{zernioMsg}</p> : null}
        {zernioPosts.length === 0 && !zernioMsg && !zernioLoading ? (
          <p className="empty-state">
            {simulation
              ? "No simulated publishes yet."
              : "No draft or scheduled posts in Zernio."}
          </p>
        ) : null}
        {zernioPosts.length > 0 ? (
          <ul className="zernio-queue-thumbs">
            {zernioPosts.map((post) => {
              const cover = post.imageUrls[0];
              const local = post.carouselId
                ? localById.get(post.carouselId)
                : undefined;
              const localHtml = local?.slides?.[0]?.html;
              return (
                <li
                  key={post.id}
                  className={`zernio-queue-thumb${!cover && !localHtml ? " is-empty" : ""}`}
                  title={`${post.status} · ${post.title}`}
                >
                  {cover ? (
                    <img src={cover} alt="" loading="lazy" />
                  ) : localHtml && local ? (
                    <SlideRenderer
                      html={localHtml}
                      aspectRatio={local.aspectRatio}
                      className="zernio-queue-thumb-slide"
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
