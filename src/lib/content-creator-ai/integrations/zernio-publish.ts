/**
 * Publish an Open Carrusel deck to Zernio with real slide media.
 *
 * Flow (all platforms):
 *   Open Carrusel PNG export → POST /v1/media/presign → PUT bytes
 *   → POST /v1/posts with mediaItems: [{ type: "image", url }, …]
 *
 * LinkedIn multi-image (up to 20) is used instead of PDF "document" posts —
 * empty/failed exports previously produced blank LinkedIn documents.
 *
 * @see https://docs.zernio.com/platforms/linkedin#multi-image-post
 * @see https://docs.zernio.com/guides/media-uploads
 */

import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

export interface ZernioPublishInput {
  postVariantId: string;
  carouselId: string;
  name: string;
  caption?: string;
  platform?: string;
  accountId?: string;
  publishNow?: boolean;
  aspectRatio?: string;
  slideCount?: number;
  slideTexts?: string[];
  openCarouselBaseUrl?: string;
}

export interface ZernioPublishResult {
  ok: boolean;
  mode: "live" | "draft" | "recorded";
  postVariantId: string;
  publishedAt: string;
  message: string;
  statusCode?: number;
  zernioPostId?: string;
  zernioStatus?: string;
  platformPostUrl?: string;
  dashboardHint?: string;
  mediaCount?: number;
  /** Distinguishes real media publish from the old text-only stub. */
  publishPipeline?: "multi-image-v2";
}

interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  isActive?: boolean;
}

interface SlidePng {
  filename: string;
  bytes: Uint8Array;
}

interface MediaItem {
  type: "image" | "document";
  url: string;
  title?: string;
}

const DEFAULT_BASE = "https://zernio.com/api/v1";
const DASHBOARD = "https://zernio.com";
const DEFAULT_OPEN_CAROUSEL = "http://localhost:3000";
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Reject tiny / empty exports (blank white 1080p PNG is usually >> 20KB). */
const MIN_PNG_BYTES = 8_000;

const MAX_IMAGES: Record<string, number> = {
  linkedin: 20,
  instagram: 10,
  threads: 10,
  twitter: 4,
  bluesky: 4,
  facebook: 10,
  tiktok: 35,
};

export function normalizeZernioApiBase(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/$/, "");
  if (
    !trimmed ||
    trimmed === "https://api.zernio.com" ||
    trimmed === "http://api.zernio.com"
  ) {
    return DEFAULT_BASE;
  }
  if (
    trimmed === "https://zernio.com" ||
    trimmed === "https://www.zernio.com"
  ) {
    return "https://zernio.com/api/v1";
  }
  if (trimmed.endsWith("/api")) return `${trimmed}/v1`;
  return trimmed;
}

function buildContent(input: ZernioPublishInput): string {
  if (input.caption?.trim()) return input.caption.trim().slice(0, 2800);
  if (input.slideTexts?.length) {
    const preview = input.slideTexts
      .slice(0, 3)
      .map((t) => t.trim())
      .filter(Boolean)
      .join(" · ");
    if (preview) {
      return `${input.name}\n\n${preview}`.slice(0, 2800);
    }
  }
  return input.name.slice(0, 2800);
}

function maxImagesFor(platform: string | undefined): number {
  if (!platform) return 10;
  return MAX_IMAGES[platform.toLowerCase()] ?? 10;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 24) return false;
  for (let i = 0; i < PNG_SIG.length; i++) {
    if (bytes[i] !== PNG_SIG[i]) return false;
  }
  return true;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  // IHDR width/height are big-endian u32 at offsets 16 and 20
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function assertValidSlidePng(slide: SlidePng, index: number): void {
  if (!isPng(slide.bytes)) {
    throw new Error(
      `Slide ${index + 1} (${slide.filename}) is not a valid PNG after Open Carrusel export.`,
    );
  }
  if (slide.bytes.byteLength < MIN_PNG_BYTES) {
    throw new Error(
      `Slide ${index + 1} is suspiciously small (${slide.bytes.byteLength} bytes) — export may have produced a blank image. Re-open the deck in Open Carrusel and retry.`,
    );
  }
  const { width, height } = pngDimensions(slide.bytes);
  if (width < 32 || height < 32) {
    throw new Error(
      `Slide ${index + 1} has invalid dimensions ${width}×${height}.`,
    );
  }
}

async function zernioFetch(
  base: string,
  key: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
}

async function listAccounts(
  base: string,
  key: string,
): Promise<ZernioAccount[]> {
  const res = await zernioFetch(base, key, "/accounts?status=connected");
  if (!res.ok) {
    const retry = await zernioFetch(base, key, "/accounts");
    if (!retry.ok) {
      const text = await retry.text().catch(() => retry.statusText);
      throw new Error(
        `List accounts failed (${retry.status}): ${text.slice(0, 200)}`,
      );
    }
    const data = (await retry.json()) as { accounts?: ZernioAccount[] };
    return Array.isArray(data.accounts) ? data.accounts : [];
  }
  const data = (await res.json()) as { accounts?: ZernioAccount[] };
  return Array.isArray(data.accounts) ? data.accounts : [];
}

function pickAccount(
  accounts: ZernioAccount[],
  preferredPlatform?: string,
  preferredAccountId?: string,
): ZernioAccount | null {
  if (!accounts.length) return null;
  if (preferredAccountId?.trim()) {
    const hit = accounts.find((a) => a._id === preferredAccountId.trim());
    if (hit) return hit;
  }
  const active = accounts.filter((a) => a.isActive !== false);
  const pool = active.length ? active : accounts;
  if (preferredPlatform?.trim()) {
    const plat = preferredPlatform.trim().toLowerCase();
    const hit = pool.find((a) => a.platform?.toLowerCase() === plat);
    if (hit) return hit;
  }
  for (const plat of ["linkedin", "instagram", "twitter", "threads"]) {
    const hit = pool.find((a) => a.platform?.toLowerCase() === plat);
    if (hit) return hit;
  }
  return pool[0] ?? null;
}

function extractPlatformUrl(
  post: Record<string, unknown> | undefined,
): string | undefined {
  if (!post) return undefined;
  const platforms = post.platforms;
  if (!Array.isArray(platforms)) return undefined;
  for (const p of platforms) {
    if (p && typeof p === "object" && "platformPostUrl" in p) {
      const url = (p as { platformPostUrl?: string }).platformPostUrl;
      if (url) return url;
    }
  }
  return undefined;
}

function openCarouselRoot(raw?: string): string {
  let root = (raw || process.env.OPENCAROUSEL_BASE_URL || DEFAULT_OPEN_CAROUSEL)
    .trim()
    .replace(/\/$/, "");
  // Browser Vite proxy / Vite origin cannot export from the API process.
  if (
    !root ||
    root.startsWith("/") ||
    root.includes("__open-carousel") ||
    /:(5173|4173)(\/|$)/.test(root)
  ) {
    root = DEFAULT_OPEN_CAROUSEL;
  }
  return root;
}

/** Export carousel slides as PNGs via Open Carrusel ZIP endpoint. */
export async function exportCarouselPngs(
  carouselId: string,
  openCarouselBaseUrl?: string,
): Promise<SlidePng[]> {
  const root = openCarouselRoot(openCarouselBaseUrl);
  const res = await fetch(
    `${root}/api/carousels/${encodeURIComponent(carouselId)}/export`,
    {
      method: "POST",
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let detail = text.slice(0, 220);
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      /* keep text */
    }
    throw new Error(
      `Open Carrusel export failed (${res.status}) for ${carouselId}: ${detail}. Is the studio running at ${root}?`,
    );
  }

  const zipBytes = new Uint8Array(await res.arrayBuffer());
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not unzip Open Carrusel export: ${msg}`);
  }

  const slides = Object.entries(files)
    .filter(([name, data]) => /\.png$/i.test(name) && data.byteLength > 0)
    .map(([name, data]) => ({
      filename: name.split("/").pop() || name,
      // Copy so we don't keep views into the zip backing store
      bytes: new Uint8Array(data),
    }))
    .sort((a, b) =>
      a.filename.localeCompare(b.filename, undefined, { numeric: true }),
    );

  if (!slides.length) {
    throw new Error(
      "Open Carrusel export ZIP contained no PNG slides. Open the deck in the studio and export once to verify.",
    );
  }

  slides.forEach((s, i) => assertValidSlidePng(s, i));
  return slides;
}

/** Build a LinkedIn document carousel PDF — one page per slide PNG. */
export async function buildCarouselPdf(
  slides: SlidePng[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!;
    assertValidSlidePng(slide, i);
    const png = await pdf.embedPng(slide.bytes);
    const page = pdf.addPage([png.width, png.height]);
    page.drawImage(png, {
      x: 0,
      y: 0,
      width: png.width,
      height: png.height,
    });
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  if (bytes.byteLength < 1_000) {
    throw new Error("Generated carousel PDF is empty — aborting publish.");
  }
  return bytes;
}

async function uploadBytesToZernio(
  base: string,
  key: string,
  input: {
    filename: string;
    contentType: "image/png" | "application/pdf";
    bytes: Uint8Array;
    mediaType: "image" | "document";
    title: string;
  },
): Promise<MediaItem> {
  const { filename, contentType, bytes, mediaType, title } = input;

  const presignRes = await zernioFetch(base, key, "/media/presign", {
    method: "POST",
    body: JSON.stringify({
      filename,
      contentType,
      size: bytes.byteLength,
    }),
  });
  const presignText = await presignRes.text().catch(() => "");
  if (!presignRes.ok) {
    throw new Error(
      `Zernio media presign failed (${presignRes.status}): ${presignText.slice(0, 200)}`,
    );
  }

  let presign: {
    uploadUrl?: string;
    publicUrl?: string;
    data?: { uploadUrl?: string; publicUrl?: string };
  };
  try {
    presign = JSON.parse(presignText) as typeof presign;
  } catch {
    throw new Error(
      `Zernio media presign returned non-JSON: ${presignText.slice(0, 120)}`,
    );
  }

  const uploadUrl = presign.uploadUrl ?? presign.data?.uploadUrl;
  const publicUrl = presign.publicUrl ?? presign.data?.publicUrl;
  if (!uploadUrl || !publicUrl) {
    throw new Error(
      `Zernio media presign missing uploadUrl/publicUrl: ${presignText.slice(0, 200)}`,
    );
  }

  // Copy into a fresh Buffer so undici sends a full body (not a zero-length view).
  const body = Buffer.from(bytes);
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
    },
    body,
    signal: AbortSignal.timeout(90_000),
  });
  if (!putRes.ok) {
    const putText = await putRes.text().catch(() => putRes.statusText);
    throw new Error(
      `Zernio media upload failed (${putRes.status}) for ${filename}: ${putText.slice(0, 160)}`,
    );
  }

  // Confirm the public URL is fetchable and non-empty before creating the post.
  await assertPublicMediaReachable(publicUrl, contentType, bytes.byteLength);

  return { type: mediaType, url: publicUrl, title };
}

async function assertPublicMediaReachable(
  publicUrl: string,
  expectType: string,
  minBytes: number,
): Promise<void> {
  // Brief settle — R2/CDN can lag a moment after PUT.
  await new Promise((r) => setTimeout(r, 400));

  const head = await fetch(publicUrl, {
    method: "HEAD",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (head?.ok) {
    const len = Number(head.headers.get("content-length") || "0");
    const ct = head.headers.get("content-type") || "";
    if (len > 0 && len < minBytes * 0.5) {
      throw new Error(
        `Uploaded media at ${publicUrl} is too small (${len} bytes) — LinkedIn would show a blank document.`,
      );
    }
    if (ct && !ct.includes(expectType.split("/")[1] ?? "") && !ct.includes(expectType)) {
      // Soft warning only — some CDNs return octet-stream
    }
    return;
  }

  // Fallback GET range
  const get = await fetch(publicUrl, {
    method: "GET",
    headers: { Range: "bytes=0-64" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!get || !(get.ok || get.status === 206)) {
    throw new Error(
      `Uploaded media is not publicly reachable (${publicUrl}). Zernio/LinkedIn would publish a blank document.`,
    );
  }
}

export async function publishCarouselToZernio(
  input: ZernioPublishInput,
): Promise<ZernioPublishResult> {
  const publishedAt = new Date().toISOString();
  const base = normalizeZernioApiBase(process.env.ZERNIO_API_BASE);
  const key = process.env.ZERNIO_API_KEY?.trim();
  const envAccountId =
    input.accountId?.trim() || process.env.ZERNIO_ACCOUNT_ID?.trim();
  const envPlatform =
    input.platform?.trim() || process.env.ZERNIO_PLATFORM?.trim();

  if (!key) {
    return {
      ok: false,
      mode: "recorded",
      postVariantId: input.postVariantId,
      publishedAt,
      message:
        "Zernio API key missing. Set it in Settings (real-data mode), Save / sync, then retry.",
      dashboardHint: DASHBOARD,
      publishPipeline: "multi-image-v2",
    };
  }

  let slides: SlidePng[];
  try {
    slides = await exportCarouselPngs(
      input.carouselId,
      input.openCarouselBaseUrl,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      mode: "recorded",
      postVariantId: input.postVariantId,
      publishedAt,
      message: msg,
      dashboardHint: DASHBOARD,
    };
  }

  let account: ZernioAccount | null = null;
  try {
    const accounts = await listAccounts(base, key);
    account = pickAccount(accounts, envPlatform, envAccountId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      mode: "recorded",
      postVariantId: input.postVariantId,
      publishedAt,
      message: `Could not reach Zernio accounts at ${base}. Check API base URL (should be https://zernio.com/api/v1). ${msg}`,
      dashboardHint: DASHBOARD,
    };
  }

  const platform = (account?.platform ?? envPlatform ?? "linkedin").toLowerCase();
  const capped = slides.slice(0, maxImagesFor(platform));
  const docTitle = input.name.slice(0, 70) || "Carousel";

  // Always publish as multi-image PNGs (LinkedIn + Instagram carousels).
  // PDF "document" posts were showing blank in Zernio/LinkedIn when export/media
  // failed or LinkedIn failed to render image-only PDFs.
  let mediaItems: MediaItem[];
  try {
    mediaItems = [];
    for (let i = 0; i < capped.length; i++) {
      const slide = capped[i]!;
      mediaItems.push(
        await uploadBytesToZernio(base, key, {
          filename: slide.filename || `slide-${i + 1}.png`,
          contentType: "image/png",
          bytes: slide.bytes,
          mediaType: "image",
          title: `Slide ${i + 1}`,
        }),
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      mode: "recorded",
      postVariantId: input.postVariantId,
      publishedAt,
      message: msg,
      dashboardHint: DASHBOARD,
      mediaCount: 0,
    };
  }

  if (mediaItems.length === 0) {
    return {
      ok: false,
      mode: "recorded",
      postVariantId: input.postVariantId,
      publishedAt,
      message:
        "No slide images uploaded — refusing to create an empty Zernio post.",
      dashboardHint: DASHBOARD,
      mediaCount: 0,
    };
  }

  const content = buildContent(input);
  const wantPublishNow = input.publishNow !== false;
  const slideCount = mediaItems.length;

  const body: Record<string, unknown> = {
    title: docTitle,
    content,
    mediaItems,
    metadata: {
      source: "liquid-copy",
      postVariantId: input.postVariantId,
      carouselId: input.carouselId,
      aspectRatio: input.aspectRatio,
      slideCount,
      publishFormat: "multi-image",
    },
  };

  let mode: ZernioPublishResult["mode"] = "draft";
  if (account && wantPublishNow) {
    body.publishNow = true;
    body.platforms = [
      { platform: account.platform, accountId: account._id },
    ];
    mode = "live";
  } else {
    body.isDraft = true;
    if (account) {
      body.platforms = [
        { platform: account.platform, accountId: account._id },
      ];
    }
    mode = "draft";
  }

  const requestId = crypto.randomUUID();
  const res = await zernioFetch(base, key, "/posts", {
    method: "POST",
    headers: { "x-request-id": requestId },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  let parsed: {
    post?: Record<string, unknown>;
    message?: string;
    error?: string;
    existingPost?: Record<string, unknown>;
  } = {};
  try {
    parsed = text ? (JSON.parse(text) as typeof parsed) : {};
  } catch {
    /* non-JSON */
  }

  if (!res.ok) {
    return {
      ok: false,
      mode: "recorded",
      postVariantId: input.postVariantId,
      publishedAt,
      statusCode: res.status,
      mediaCount: slideCount,
      message:
        parsed.error ||
        `Zernio create post failed (${res.status}): ${text.slice(0, 220)}`,
      dashboardHint: DASHBOARD,
    };
  }

  const post = parsed.post ?? parsed.existingPost;
  const zernioPostId =
    post && typeof post._id === "string" ? post._id : undefined;
  const zernioStatus =
    post && typeof post.status === "string"
      ? post.status
      : mode === "draft"
        ? "draft"
        : "published";
  const platformPostUrl = extractPlatformUrl(post);
  const postVariantId = zernioPostId || input.postVariantId;

  const formatLabel = `${slideCount}-image carousel`;

  if (!account) {
    return {
      ok: true,
      mode: "draft",
      postVariantId,
      publishedAt,
      statusCode: res.status,
      zernioPostId,
      zernioStatus,
      mediaCount: slideCount,
      publishPipeline: "multi-image-v2",
      message: `Saved ${formatLabel} as a Zernio draft (no connected social account). Open ${DASHBOARD} → Posts.`,
      dashboardHint: DASHBOARD,
    };
  }

  if (mode === "draft") {
    return {
      ok: true,
      mode: "draft",
      postVariantId,
      publishedAt,
      statusCode: res.status,
      zernioPostId,
      zernioStatus,
      mediaCount: slideCount,
      publishPipeline: "multi-image-v2",
      message: `Saved ${formatLabel} draft on ${account.platform} (${account.username || account.displayName || account._id}). Open ${DASHBOARD} → Posts.`,
      dashboardHint: DASHBOARD,
    };
  }

  return {
    ok: true,
    mode: "live",
    postVariantId,
    publishedAt,
    statusCode: res.status,
    zernioPostId,
    zernioStatus,
    platformPostUrl,
    mediaCount: slideCount,
    publishPipeline: "multi-image-v2",
    message: platformPostUrl
      ? `Published ${formatLabel} to ${account.platform}: ${platformPostUrl}`
      : `Created ${formatLabel} on Zernio (${zernioStatus ?? "ok"}) for ${account.platform} · post ${zernioPostId ?? postVariantId}. Check ${DASHBOARD} → Posts.`,
    dashboardHint: DASHBOARD,
  };
}
