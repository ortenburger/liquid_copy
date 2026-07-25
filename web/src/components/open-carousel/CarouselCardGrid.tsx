/**
 * Card grid matching Open Carrusel dashboard (open-carrusel/src/app/page.tsx).
 */
import type { ReactNode } from "react";
import { Badge } from "../ui/Badge";
import { SlideRenderer } from "./SlideRenderer";
import type { OpenCarouselItem } from "../../lib/open-carousel";
import "./CarouselCardGrid.css";

export interface CarouselCardGridProps {
  carousels: OpenCarouselItem[];
  onOpen?: (carousel: OpenCarouselItem) => void;
  /** Per-card actions (e.g. Publish to Zernio). Clicks stop card navigation. */
  renderActions?: (carousel: OpenCarouselItem) => ReactNode;
  emptyLabel?: string;
}

function statusTone(status: NonNullable<OpenCarouselItem["status"]>) {
  if (status === "published") return "active" as const;
  if (status === "publishing" || status === "queued") return "processing" as const;
  if (status === "failed") return "failed" as const;
  return "idle" as const;
}

export function CarouselCardGrid({
  carousels,
  onOpen,
  renderActions,
  emptyLabel = "No queued carousels yet.",
}: CarouselCardGridProps) {
  if (carousels.length === 0) {
    return <p className="empty-state">{emptyLabel}</p>;
  }

  return (
    <div className="oc-card-grid">
      {carousels.map((carousel) => {
        const first = carousel.slides[0];
        const updated = carousel.updatedAt
          ? new Date(carousel.updatedAt).toLocaleDateString()
          : "—";
        return (
          <article key={carousel.id} className="oc-card">
            <button
              type="button"
              className="oc-card-main"
              onClick={() => onOpen?.(carousel)}
            >
              <div className="oc-card-preview">
                {first?.html ? (
                  <SlideRenderer
                    html={first.html}
                    aspectRatio={carousel.aspectRatio}
                    className="oc-card-slide"
                  />
                ) : (
                  <span className="oc-card-preview-empty" aria-hidden>
                    ▦
                  </span>
                )}
              </div>
              <h3 className="oc-card-title">{carousel.name}</h3>
              <div className="oc-card-meta">
                <Badge tone="idle">{carousel.aspectRatio}</Badge>
                <span>
                  {carousel.slideCount} slide
                  {carousel.slideCount === 1 ? "" : "s"}
                </span>
                <span>{updated}</span>
                {carousel.status ? (
                  <Badge tone={statusTone(carousel.status)}>
                    {carousel.status}
                  </Badge>
                ) : null}
              </div>
              {carousel.publishMessage ? (
                <p className="oc-card-note">{carousel.publishMessage}</p>
              ) : null}
            </button>
            {renderActions ? (
              <div
                className="oc-card-actions"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {renderActions(carousel)}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
