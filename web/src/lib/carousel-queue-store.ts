import type { OpenCarouselItem } from "./open-carousel";

const STORAGE_KEY = "liquid-copy.carousel-queue.v1";

function read(): OpenCarouselItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpenCarouselItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: OpenCarouselItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 40)));
}

export function listQueuedCarousels(): OpenCarouselItem[] {
  return read();
}

export function upsertQueuedCarousel(item: OpenCarouselItem): OpenCarouselItem[] {
  const next = [item, ...read().filter((c) => c.id !== item.id)];
  write(next);
  return next;
}

export function patchQueuedCarousel(
  id: string,
  patch: Partial<OpenCarouselItem>,
): OpenCarouselItem[] {
  const next = read().map((c) => (c.id === id ? { ...c, ...patch } : c));
  write(next);
  return next;
}
