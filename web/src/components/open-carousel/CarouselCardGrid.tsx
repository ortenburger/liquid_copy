/**
 * Card grid matching Open Carrusel dashboard (open-carrusel/src/app/page.tsx).
 */
import { Badge } from "../ui/Badge";
import { SlideRenderer } from "./SlideRenderer";
import type { OpenCarouselItem } from "../../lib/open-carousel";
import "./CarouselCardGrid.css";

export interface CarouselCardGridProps {
  carousels: OpenCarouselItem[];
  onOpen?: (carousel: OpenCarouselItem) => void;
  emptyLabel?: string;
}

export function CarouselCardGrid({
  carousels,
  onOpen,
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
          <button
            key={carousel.id}
            type="button"
            className="oc-card"
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
                <Badge tone="processing">{carousel.status}</Badge>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
