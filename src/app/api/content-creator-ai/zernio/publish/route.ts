/**
 * POST /api/content-creator-ai/zernio/publish — create a Zernio post (publish or draft).
 */
import {
  jsonResponse,
  errorResponse,
  readJsonBody,
} from "@/lib/content-creator-ai/api/runtime.js";
import { publishCarouselToZernio } from "@/lib/content-creator-ai/integrations/zernio-publish.js";

interface Body {
  postVariantId?: string;
  carouselId?: string;
  name?: string;
  caption?: string;
  platform?: string;
  accountId?: string;
  publishNow?: boolean;
  aspectRatio?: string;
  slideCount?: number;
  slideTexts?: string[];
  /** Skip the live Zernio API and return a successful dry-run. */
  simulate?: boolean;
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody<Body>(request);
  if (!body) return errorResponse("Request body must be valid JSON");
  if (!body.carouselId?.trim()) {
    return errorResponse("carouselId is required");
  }

  const postVariantId =
    body.postVariantId?.trim() ||
    `pv-${body.carouselId.trim().slice(0, 24)}-${Date.now().toString(36)}`;

  if (body.simulate === true) {
    const publishedAt = new Date().toISOString();
    return jsonResponse({
      ok: true,
      mode: "recorded",
      postVariantId,
      publishedAt,
      message: `Simulated Zernio publish for “${body.name?.trim() || "carousel"}” (API dry-run — no live post).`,
      zernioPostId: `sim-${postVariantId}`,
      dashboardHint: "https://zernio.com",
    });
  }

  try {
    const result = await publishCarouselToZernio({
      postVariantId,
      carouselId: body.carouselId.trim(),
      name: body.name?.trim() || "Untitled carousel",
      caption: body.caption,
      platform: body.platform,
      accountId: body.accountId,
      publishNow: body.publishNow,
      aspectRatio: body.aspectRatio,
      slideCount: body.slideCount,
      slideTexts: Array.isArray(body.slideTexts) ? body.slideTexts : undefined,
    });
    return jsonResponse(result, result.ok ? 200 : 400);
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Zernio publish failed",
      500,
    );
  }
}
