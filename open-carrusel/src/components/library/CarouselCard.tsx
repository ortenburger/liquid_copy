"use client";

import { Calendar, Copy, Layers, SlidersHorizontal, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SlideRenderer } from "@/components/editor/SlideRenderer";
import type { Carousel } from "@/types/carousel";

interface CarouselCardProps {
  carousel: Carousel;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string, name: string) => void;
}

/** Dashboard library card — slide preview + meta (used by Liquid Copy Testing Plan port). */
export function CarouselCard({
  carousel,
  onOpen,
  onDuplicate,
  onDelete,
}: CarouselCardProps) {
  return (
    <div
      onClick={() => onOpen(carousel.id)}
      className="relative text-left rounded-xl border border-border bg-surface hover:border-accent/50 hover:shadow-md hover:-translate-y-0.5 p-4 group cursor-pointer transition-[translate,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
    >
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            void onDuplicate(carousel.id);
          }}
          className="h-7 w-7 rounded-lg flex items-center justify-center bg-white border border-border hover:bg-muted"
          aria-label={`Duplicate ${carousel.name}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => onDelete(e, carousel.id, carousel.name)}
          className="h-7 w-7 rounded-lg flex items-center justify-center bg-white border border-border hover:bg-destructive hover:text-white hover:border-destructive"
          aria-label={`Delete ${carousel.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="h-28 rounded-lg bg-muted mb-3 flex items-center justify-center overflow-hidden">
        {carousel.slides.length > 0 ? (
          <SlideRenderer
            html={carousel.slides[0].html}
            aspectRatio={carousel.aspectRatio}
            className="w-full h-full"
          />
        ) : (
          <Layers className="h-8 w-8 text-muted-foreground/30" />
        )}
      </div>
      <h3 className="font-semibold text-sm group-hover:text-accent transition-colors truncate">
        {carousel.name}
      </h3>
      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
        <Badge variant="secondary" className="text-[10px]">
          <SlidersHorizontal className="h-2.5 w-2.5 mr-1" />
          {carousel.aspectRatio}
        </Badge>
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {new Date(carousel.updatedAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
