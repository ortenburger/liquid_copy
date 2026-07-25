import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Progress } from "../../components/ui/Progress";
import { CarouselCardGrid } from "../../components/open-carousel/CarouselCardGrid";
import { api } from "../../lib/api";
import {
  listQueuedCarousels,
  patchQueuedCarousel,
} from "../../lib/carousel-queue-store";
import { useAsyncAction, useDataMode } from "../../lib/hooks";
import {
  fetchOpenCarousels,
  openCarouselEditorUrl,
  type OpenCarouselItem,
} from "../../lib/open-carousel";
import { loadSettings } from "../../lib/settings";
import "./workspace.css";

function mergeQueue(
  stored: OpenCarouselItem[],
  live: OpenCarouselItem[],
): OpenCarouselItem[] {
  const byId = new Map<string, OpenCarouselItem>();
  for (const c of live) {
    byId.set(c.id, { ...c, status: c.status ?? "queued" });
  }
  for (const c of stored) {
    const existing = byId.get(c.id);
    byId.set(c.id, existing ? { ...existing, ...c, slides: c.slides?.length ? c.slides : existing.slides } : c);
  }
  return [...byId.values()].sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  );
}

export function TestPage() {
  const { simulation } = useDataMode();
  const { busy, error: actionError, run, clearError } = useAsyncAction();
  const [queue, setQueue] = useState<OpenCarouselItem[]>(() =>
    listQueuedCarousels(),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const reloadQueue = useCallback(async () => {
    const stored = listQueuedCarousels();
    if (simulation) {
      setQueue(stored);
      setMsg(stored.length ? `${stored.length} queued (incl. chat agent)` : null);
      return;
    }
    const baseUrl = loadSettings().openCarouselBaseUrl;
    const result = await fetchOpenCarousels(baseUrl);
    if (!result.ok) {
      setError(result.message);
      setQueue(stored);
      return;
    }
    setError(null);
    setQueue(mergeQueue(stored, result.carousels));
    setMsg(result.message);
  }, [simulation]);

  useEffect(() => {
    void reloadQueue();
  }, [reloadQueue]);

  async function onQueue() {
    clearError();
    setError(null);
    setMsg(null);
    await run(async () => {
      const item = await api.queueTestCarousel();
      setQueue((prev) => [item, ...prev.filter((c) => c.id !== item.id)]);
      setMsg(
        simulation
          ? `Queued demo carousel “${item.name}”.`
          : `Queued in Open Carrusel · ${item.id}`,
      );
      setQueue(listQueuedCarousels());
    });
  }

  async function onPublish(
    carousel: OpenCarouselItem,
    options?: { simulate?: boolean },
  ) {
    if (carousel.status === "published" || carousel.status === "publishing") {
      return;
    }
    // draft / failed / queued can retry
    clearError();
    setPublishingId(carousel.id);
    patchQueuedCarousel(carousel.id, { status: "publishing" });
    setQueue((prev) =>
      prev.map((c) =>
        c.id === carousel.id ? { ...c, status: "publishing" as const } : c,
      ),
    );
    try {
      const result = await api.publishCarouselToZernio(carousel, options);
      const status = !result.ok
        ? ("failed" as const)
        : result.mode === "draft"
          ? ("draft" as const)
          : ("published" as const);
      const patch = {
        status,
        postVariantId: result.postVariantId,
        publishedAt: result.publishedAt,
        publishMessage: result.message,
      };
      patchQueuedCarousel(carousel.id, patch);
      setQueue((prev) =>
        prev.map((c) => (c.id === carousel.id ? { ...c, ...patch } : c)),
      );
      if (!result.ok) setError(result.message);
      else setMsg(result.message);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      patchQueuedCarousel(carousel.id, {
        status: "failed",
        publishMessage: message,
      });
      setQueue((prev) =>
        prev.map((c) =>
          c.id === carousel.id
            ? {
                ...c,
                status: "failed" as const,
                publishMessage: message,
              }
            : c,
        ),
      );
    } finally {
      setPublishingId(null);
    }
  }

  function openStudio(item: OpenCarouselItem) {
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

  const displayError = error ?? actionError;

  return (
    <div className="page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Publish sandbox</p>
          <h1 className="page-title">Test</h1>
        </div>
        <div className="mode-toggle">
          <Badge tone={simulation ? "processing" : "active"}>
            {simulation ? "Simulation" : "Real"}
          </Badge>
          <Button variant="accent" disabled={busy} onClick={() => void onQueue()}>
            Queue carousel
          </Button>
        </div>
      </header>

      <p className="page-lead">
        Queue an Open Carrusel deck, preview it with the studio cards, then
        publish to Zernio — or use <strong>Simulate Zernio</strong> when the live
        API is unavailable. Configure keys under{" "}
        <Link to="/app/settings">Settings</Link>
        {!simulation ? (
          <>
            {" "}
            · studio at{" "}
            <code>{loadSettings().openCarouselBaseUrl || "http://localhost:3000"}</code>
          </>
        ) : null}
        .
      </p>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Queue</h2>
          <span className="panel-meta">{queue.length} carousels</span>
        </div>
        <p className="page-lead" style={{ marginBottom: "var(--space-md)" }}>
          {simulation
            ? "Simulation builds a local preview card. Switch to real data to create decks in Open Carrusel."
            : "Creates a carousel in Open Carrusel with three seeded slides, then shows it here."}
        </p>
        <div className="list-row-actions">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void onQueue()}
          >
            {busy ? "Queuing…" : "Queue carousel"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void reloadQueue()}
          >
            Refresh
          </Button>
        </div>
        <Progress active={busy} label="Creating Open Carrusel deck" />
        {msg ? <p className="info-banner">{msg}</p> : null}
        {displayError ? <p className="error-banner">{displayError}</p> : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Queued carousels</h2>
          <span className="panel-meta">Open Carrusel previews</span>
        </div>
        <CarouselCardGrid
          carousels={queue}
          onOpen={openStudio}
          emptyLabel="No carousels yet. Press Queue carousel to generate one."
          renderActions={(c) => (
            <>
              <Button
                variant="ghost"
                disabled={
                  publishingId === c.id ||
                  c.status === "published" ||
                  c.status === "publishing"
                }
                onClick={() => void onPublish(c, { simulate: true })}
              >
                {publishingId === c.id ? "Working…" : "Simulate Zernio"}
              </Button>
              <Button
                variant="accent"
                disabled={
                  publishingId === c.id ||
                  c.status === "published" ||
                  c.status === "publishing" ||
                  simulation
                }
                onClick={() => void onPublish(c)}
              >
                {c.status === "published"
                  ? "Published"
                  : c.status === "draft"
                    ? "Draft in Zernio — retry publish"
                    : publishingId === c.id
                      ? "Publishing…"
                      : "Publish to Zernio"}
              </Button>
              {c.publishMessage ? (
                <span className="panel-meta">{c.publishMessage}</span>
              ) : c.postVariantId ? (
                <span className="panel-meta">{c.postVariantId}</span>
              ) : null}
            </>
          )}
        />
      </section>
    </div>
  );
}
