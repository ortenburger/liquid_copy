export interface OpenCarouselSlide {
  id: string;
  html: string;
  order: number;
}

export interface OpenCarouselItem {
  id: string;
  name: string;
  aspectRatio: string;
  slideCount: number;
  slides: OpenCarouselSlide[];
  caption?: string;
  updatedAt: string;
  /** Present when sourced from the testing-plan queue (demo / publish queue). */
  status?: "queued" | "draft" | "published";
}

/** @deprecated Prefer OpenCarouselItem */
export type OpenCarouselSummary = OpenCarouselItem;

export interface OpenCarouselPreviewResult {
  ok: boolean;
  message: string;
  carousels: OpenCarouselItem[];
}

interface RawSlide {
  id?: string;
  html?: string;
  order?: number;
}

interface RawCarousel {
  id?: string;
  name?: string;
  aspectRatio?: string;
  slides?: RawSlide[];
  caption?: string;
  updatedAt?: string;
}

/** Prefer Vite same-origin proxy when talking to the local studio. */
function apiRoot(baseUrl: string): string {
  const root = baseUrl.replace(/\/$/, "") || "http://localhost:3000";
  if (typeof window === "undefined") return root;
  try {
    const u = new URL(root);
    const local =
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      (u.port === "3000" || u.port === "");
    if (local && import.meta.env.DEV) {
      return "/__open-carousel";
    }
  } catch {
    /* use absolute */
  }
  return root;
}

function mapCarousel(c: RawCarousel): OpenCarouselItem | null {
  if (!c || typeof c.id !== "string") return null;
  const slides = Array.isArray(c.slides)
    ? c.slides
        .filter((s): s is RawSlide & { html: string } => Boolean(s?.html))
        .map((s, i) => ({
          id: s.id ?? `slide-${i}`,
          html: s.html,
          order: typeof s.order === "number" ? s.order : i,
        }))
        .sort((a, b) => a.order - b.order)
    : [];
  return {
    id: c.id,
    name: c.name ?? "Untitled",
    aspectRatio: c.aspectRatio ?? "4:5",
    slideCount: slides.length,
    slides,
    caption: c.caption,
    updatedAt: c.updatedAt ?? "",
  };
}

/** Fetch carousels from a local Open Carrusel instance (includes slide HTML). */
export async function fetchOpenCarousels(
  baseUrl: string,
): Promise<OpenCarouselPreviewResult> {
  const displayRoot = baseUrl.replace(/\/$/, "") || "http://localhost:3000";
  const root = apiRoot(baseUrl);
  try {
    const res = await fetch(`${root}/api/carousels`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        ok: false,
        message: `Open Carrusel responded ${res.status}. Is it running at ${displayRoot}?`,
        carousels: [],
      };
    }
    const data = (await res.json()) as { carousels?: RawCarousel[] } | RawCarousel[];
    const list = Array.isArray(data) ? data : (data.carousels ?? []);
    const carousels = list
      .map(mapCarousel)
      .filter((c): c is OpenCarouselItem => c !== null);

    return {
      ok: true,
      message:
        carousels.length === 0
          ? `Connected to ${displayRoot} — no carousels yet.`
          : `Connected · ${carousels.length} carousel${carousels.length === 1 ? "" : "s"}`,
      carousels,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message:
        msg.includes("Failed to fetch") || msg.includes("NetworkError")
          ? `Cannot reach Open Carrusel at ${displayRoot}. Start it with: cd open-carrusel && npm run dev`
          : msg,
      carousels: [],
    };
  }
}

export function openCarouselEditorUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/$/, "")}/carousel/${id}`;
}

export function openCarouselHomeUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "") || "http://localhost:3000";
}
