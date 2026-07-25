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
  status?: "queued" | "draft" | "published" | "publishing" | "failed";
  /** Set after Publish to Zernio */
  postVariantId?: string;
  publishedAt?: string;
  publishMessage?: string;
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
export function openCarouselApiRoot(baseUrl: string): string {
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
  const root = openCarouselApiRoot(baseUrl);
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

export interface CarouselSlideBrief {
  title: string;
  subtitle: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slideHtml(title: string, subtitle: string, accent: string): string {
  return `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:72px;background:linear-gradient(160deg,#0b1220 0%,#152238 55%,${accent} 140%);font-family:'Geist','Segoe UI',sans-serif;color:#f8fafc;">
  <p style="font-size:28px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.7;margin:0 0 16px;">Queued</p>
  <h1 style="font-size:64px;line-height:1.05;margin:0 0 20px;font-weight:700;">${escapeHtml(title)}</h1>
  <p style="font-size:32px;line-height:1.35;margin:0;opacity:0.9;">${escapeHtml(subtitle)}</p>
</div>`;
}

/** Build 3 slide briefs from a freeform idea when the model doesn't pass slides. */
export function briefsFromIdea(idea: string, name?: string): CarouselSlideBrief[] {
  const clean = idea.trim().replace(/\s+/g, " ");
  const hook = name?.trim() || clean.slice(0, 72) || "Untitled concept";
  const rest = clean.length > 72 ? clean.slice(0, 140) : clean;
  return [
    { title: hook, subtitle: rest || "Concept from chat." },
    {
      title: "Why it matters",
      subtitle: "Make the tension concrete — one audience, one friction.",
    },
    {
      title: "Next step",
      subtitle: "Ship a variant, measure, learn. Publish when ready.",
    },
  ];
}

export interface QueueOpenCarouselOptions {
  name?: string;
  aspectRatio?: "1:1" | "4:5" | "9:16";
  /** Concept / idea grounding the deck */
  idea?: string;
  slides?: CarouselSlideBrief[];
}

/**
 * Create a carousel in Open Carrusel and seed preview slides (Test tab / agent).
 */
export async function queueOpenCarousel(
  baseUrl: string,
  options?: QueueOpenCarouselOptions,
): Promise<OpenCarouselItem> {
  const root = openCarouselApiRoot(baseUrl);
  const idea = options?.idea?.trim() || "";
  const name =
    options?.name?.trim() ||
    (idea ? idea.slice(0, 64) : null) ||
    `Test queue ${new Date().toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  const aspectRatio = options?.aspectRatio ?? "4:5";
  const briefs =
    options?.slides && options.slides.length > 0
      ? options.slides.slice(0, 8)
      : briefsFromIdea(idea || name, name);

  const createRes = await fetch(`${root}/api/carousels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, aspectRatio }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!createRes.ok) {
    throw new Error(
      `Open Carrusel create failed (${createRes.status}). Is the studio running?`,
    );
  }
  const created = (await createRes.json()) as RawCarousel;
  const id = created.id;
  if (!id) throw new Error("Open Carrusel returned no carousel id");

  const accents = ["#0f766e", "#0369a1", "#c2410c", "#7c3aed", "#b45309"];
  const slides: OpenCarouselSlide[] = [];
  for (let i = 0; i < briefs.length; i++) {
    const s = briefs[i];
    const html = slideHtml(s.title, s.subtitle, accents[i % accents.length]);
    const slideRes = await fetch(`${root}/api/carousels/${id}/slides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, notes: `queued-slide-${i + 1}` }),
      signal: AbortSignal.timeout(12_000),
    });
    if (slideRes.ok) {
      const slide = (await slideRes.json()) as RawSlide;
      slides.push({
        id: slide.id ?? `slide-${i}`,
        html: slide.html ?? html,
        order: typeof slide.order === "number" ? slide.order : i,
      });
    } else {
      slides.push({ id: `slide-${i}`, html, order: i });
    }
  }

  const caption = idea
    ? `${name} — ${idea.slice(0, 180)}`
    : `${name} — queued from Liquid Copy`;

  await fetch(`${root}/api/carousels/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caption }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);

  return {
    id,
    name,
    aspectRatio,
    slideCount: slides.length,
    slides,
    caption,
    updatedAt: new Date().toISOString(),
    status: "queued",
  };
}

/** Build a local (simulation) queued carousel from an idea — no Open Carrusel needed. */
export function buildDemoQueuedCarousel(
  options: QueueOpenCarouselOptions,
): OpenCarouselItem {
  const idea = options.idea?.trim() || "Untitled concept";
  const name = options.name?.trim() || idea.slice(0, 64);
  const aspectRatio = options.aspectRatio ?? "4:5";
  const briefs =
    options.slides && options.slides.length > 0
      ? options.slides.slice(0, 8)
      : briefsFromIdea(idea, name);
  const accents = ["#0f766e", "#0369a1", "#c2410c", "#7c3aed", "#b45309"];
  const id = `demo-oc-${Date.now().toString(36)}`;
  const slides = briefs.map((s, i) => ({
    id: `${id}-s${i}`,
    order: i,
    html: slideHtml(s.title, s.subtitle, accents[i % accents.length]),
  }));
  return {
    id,
    name,
    aspectRatio,
    slideCount: slides.length,
    slides,
    caption: `${name} — ${idea.slice(0, 180)}`,
    updatedAt: new Date().toISOString(),
    status: "queued",
  };
}
