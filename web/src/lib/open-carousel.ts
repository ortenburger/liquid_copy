import type { CarouselSlideBrief, SlideRole } from "./carousel-brief";
import { normalizeSlideBriefs } from "./carousel-brief";

export type { CarouselSlideBrief, SlideRole } from "./carousel-brief";
export { briefsFromIdea, draftCarouselBriefs } from "./carousel-brief";

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
  /** Linked hypothesis when generated from the week posting plan. */
  hypothesisId?: string;
  /** Planned post time (ISO) for the week schedule. */
  scheduledAt?: string;
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PALETTE: Array<{ bg: string; accent: string; ink: string; muted: string }> = [
  { bg: "#0b1220", accent: "#2dd4bf", ink: "#f8fafc", muted: "rgba(248,250,252,0.72)" },
  { bg: "#111827", accent: "#38bdf8", ink: "#f8fafc", muted: "rgba(248,250,252,0.72)" },
  { bg: "#1c1917", accent: "#fb923c", ink: "#fafaf9", muted: "rgba(250,250,249,0.72)" },
  { bg: "#0f172a", accent: "#a78bfa", ink: "#f8fafc", muted: "rgba(248,250,252,0.72)" },
  { bg: "#14532d", accent: "#86efac", ink: "#f0fdf4", muted: "rgba(240,253,244,0.75)" },
  { bg: "#3b0764", accent: "#e9d5ff", ink: "#faf5ff", muted: "rgba(250,245,255,0.75)" },
];

function slideHtml(
  brief: CarouselSlideBrief,
  index: number,
  total: number,
): string {
  const role: SlideRole = brief.role ?? (index === 0 ? "hook" : index === total - 1 ? "cta" : "insight");
  const palette = PALETTE[index % PALETTE.length]!;
  const title = escapeHtml(brief.title);
  const subtitle = escapeHtml(brief.subtitle);
  const eyebrow = escapeHtml(
    brief.eyebrow || String(index + 1).padStart(2, "0"),
  );
  const progress = `${index + 1} / ${total}`;

  // Use system fonts only — "Geist" triggers Google Fonts fetch in export and can hang Puppeteer.
  const font = "ui-sans-serif,Segoe UI,Helvetica,Arial,sans-serif";

  if (role === "hook") {
    return `<div style="width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;padding:64px;background:radial-gradient(120% 80% at 10% 0%,${palette.accent}33 0%,transparent 55%),linear-gradient(165deg,${palette.bg} 0%,#020617 100%);font-family:${font};color:${palette.ink};">
  <div style="display:flex;justify-content:space-between;align-items:center;font-size:22px;letter-spacing:0.16em;text-transform:uppercase;color:${palette.muted};">
    <span>${eyebrow}</span><span>${progress}</span>
  </div>
  <div>
    <h1 style="font-size:68px;line-height:1.02;margin:0 0 28px;font-weight:700;letter-spacing:-0.02em;">${title}</h1>
    <p style="font-size:30px;line-height:1.35;margin:0;max-width:92%;color:${palette.muted};">${subtitle}</p>
  </div>
  <div style="height:6px;width:28%;background:${palette.accent};border-radius:999px;"></div>
</div>`;
  }

  if (role === "cta") {
    return `<div style="width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end;padding:64px;background:linear-gradient(155deg,${palette.bg} 0%,${palette.accent} 160%);font-family:${font};color:${palette.ink};">
  <p style="font-size:22px;letter-spacing:0.16em;text-transform:uppercase;margin:0 0 24px;color:${palette.muted};">${eyebrow} · ${progress}</p>
  <h1 style="font-size:60px;line-height:1.05;margin:0 0 24px;font-weight:700;">${title}</h1>
  <p style="font-size:30px;line-height:1.4;margin:0 0 40px;max-width:92%;">${subtitle}</p>
  <div style="display:inline-flex;align-self:flex-start;padding:18px 28px;border-radius:999px;background:${palette.ink};color:${palette.bg};font-size:24px;font-weight:650;letter-spacing:0.02em;">Swipe saved → act</div>
</div>`;
  }

  if (role === "problem") {
    return `<div style="width:100%;height:100%;box-sizing:border-box;display:grid;grid-template-rows:auto 1fr auto;padding:64px;background:${palette.bg};font-family:${font};color:${palette.ink};">
  <p style="font-size:22px;letter-spacing:0.16em;text-transform:uppercase;margin:0;color:${palette.accent};">${eyebrow}</p>
  <div style="display:flex;flex-direction:column;justify-content:center;">
    <h1 style="font-size:56px;line-height:1.08;margin:0 0 24px;font-weight:700;">${title}</h1>
    <p style="font-size:30px;line-height:1.4;margin:0;color:${palette.muted};border-left:4px solid ${palette.accent};padding-left:24px;">${subtitle}</p>
  </div>
  <p style="margin:0;font-size:20px;letter-spacing:0.12em;text-transform:uppercase;color:${palette.muted};">${progress}</p>
</div>`;
  }

  // insight / proof / howto
  return `<div style="width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;padding:64px;background:linear-gradient(180deg,${palette.bg} 0%,#020617 100%);font-family:${font};color:${palette.ink};">
  <div style="display:flex;justify-content:space-between;align-items:baseline;">
    <p style="font-size:22px;letter-spacing:0.16em;text-transform:uppercase;margin:0;color:${palette.accent};">${eyebrow}</p>
    <p style="font-size:20px;margin:0;color:${palette.muted};">${progress}</p>
  </div>
  <div>
    <h1 style="font-size:54px;line-height:1.08;margin:0 0 22px;font-weight:700;">${title}</h1>
    <p style="font-size:30px;line-height:1.4;margin:0;color:${palette.muted};">${subtitle}</p>
  </div>
  <div style="display:flex;gap:10px;">
    ${Array.from({ length: total }, (_, i) =>
      `<span style="flex:1;height:4px;border-radius:999px;background:${i === index ? palette.accent : "rgba(248,250,252,0.18)"};"></span>`,
    ).join("")}
  </div>
</div>`;
}

export interface QueueOpenCarouselOptions {
  name?: string;
  aspectRatio?: "1:1" | "4:5" | "9:16";
  /** Concept / idea grounding the deck */
  idea?: string;
  audience?: string;
  platform?: string;
  tone?: string;
  cta?: string;
  slides?: CarouselSlideBrief[];
  hypothesisId?: string;
  scheduledAt?: string;
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
  const briefs = normalizeSlideBriefs(options?.slides, idea || name, name);

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

  const slides: OpenCarouselSlide[] = [];
  for (let i = 0; i < briefs.length; i++) {
    const s = briefs[i]!;
    const html = slideHtml(s, i, briefs.length);
    const slideRes = await fetch(`${root}/api/carousels/${id}/slides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html,
        notes: `${s.role ?? "slide"}:${i + 1}`,
      }),
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

  const caption = [
    name,
    idea ? idea.slice(0, 160) : null,
    options?.audience ? `Audience: ${options.audience}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

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
    hypothesisId: options?.hypothesisId,
    scheduledAt: options?.scheduledAt,
  };
}

/** Build a local (simulation) queued carousel from an idea — no Open Carrusel needed. */
export function buildDemoQueuedCarousel(
  options: QueueOpenCarouselOptions,
): OpenCarouselItem {
  const idea = options.idea?.trim() || "Untitled concept";
  const name = options.name?.trim() || idea.slice(0, 64);
  const aspectRatio = options.aspectRatio ?? "4:5";
  const briefs = normalizeSlideBriefs(options.slides, idea, name);
  const id = `demo-oc-${Date.now().toString(36)}`;
  const slides = briefs.map((s, i) => ({
    id: `${id}-s${i}`,
    order: i,
    html: slideHtml(s, i, briefs.length),
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
    hypothesisId: options.hypothesisId,
    scheduledAt: options.scheduledAt,
  };
}
