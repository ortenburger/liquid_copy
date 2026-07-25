/**
 * Publish / draft a carousel variant via the real Zernio Posts API.
 * Docs: https://docs.zernio.com/posts/create-post
 * Base: https://zernio.com/api/v1
 */

export interface ZernioPublishInput {
  postVariantId: string;
  carouselId: string;
  name: string;
  caption?: string;
  /** Preferred platform (linkedin, instagram, twitter, …). */
  platform?: string;
  /** Connected Zernio account _id. If omitted, first matching/connected account is used. */
  accountId?: string;
  /** When true (default), publish immediately if an account is available. */
  publishNow?: boolean;
  aspectRatio?: string;
  slideCount?: number;
  /** Optional slide titles/body used to build caption when caption is empty. */
  slideTexts?: string[];
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
}

interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  isActive?: boolean;
}

const DEFAULT_BASE = "https://zernio.com/api/v1";
const DASHBOARD = "https://zernio.com";

/** Normalize legacy/wrong bases to the documented API root. */
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
  const parts: string[] = [];
  if (input.caption?.trim()) parts.push(input.caption.trim());
  if (input.slideTexts?.length) {
    parts.push(
      input.slideTexts
        .map((t, i) => (t.trim() ? `${i + 1}. ${t.trim()}` : ""))
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (!parts.length) {
    parts.push(
      `${input.name}\n\n(Carousel from Liquid Copy · ${input.slideCount ?? 0} slides · ${input.aspectRatio ?? "4:5"})`,
    );
  }
  return parts.join("\n\n").slice(0, 2800);
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
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  });
}

async function listAccounts(
  base: string,
  key: string,
): Promise<ZernioAccount[]> {
  const res = await zernioFetch(base, key, "/accounts?status=connected");
  if (!res.ok) {
    // Fallback without status filter (older responses)
    const retry = await zernioFetch(base, key, "/accounts");
    if (!retry.ok) {
      const text = await retry.text().catch(() => retry.statusText);
      throw new Error(`List accounts failed (${retry.status}): ${text.slice(0, 200)}`);
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
  // Prefer LinkedIn for B2B carousels, then Instagram, then first
  for (const plat of ["linkedin", "instagram", "twitter", "threads"]) {
    const hit = pool.find((a) => a.platform?.toLowerCase() === plat);
    if (hit) return hit;
  }
  return pool[0] ?? null;
}

function extractPlatformUrl(post: Record<string, unknown> | undefined): string | undefined {
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
    };
  }

  const content = buildContent(input);
  const wantPublishNow = input.publishNow !== false;

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

  const body: Record<string, unknown> = {
    title: input.name.slice(0, 120),
    content,
    metadata: {
      source: "liquid-copy",
      postVariantId: input.postVariantId,
      carouselId: input.carouselId,
      aspectRatio: input.aspectRatio,
      slideCount: input.slideCount,
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

  // Use Zernio post id as the variant id for later metrics if available
  const postVariantId = zernioPostId || input.postVariantId;

  if (!account) {
    return {
      ok: true,
      mode: "draft",
      postVariantId,
      publishedAt,
      statusCode: res.status,
      zernioPostId,
      zernioStatus,
      message: `Saved as a Zernio draft (no connected social account). Open ${DASHBOARD} → Posts to find “${input.name}”, connect an account, then publish.`,
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
      message: `Saved as a Zernio draft on ${account.platform} (${account.username || account.displayName || account._id}). Open ${DASHBOARD} → Posts.`,
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
    message: platformPostUrl
      ? `Published to ${account.platform}: ${platformPostUrl}`
      : `Created on Zernio (${zernioStatus ?? "ok"}) for ${account.platform} · post ${zernioPostId ?? postVariantId}. Check ${DASHBOARD} → Posts if the social URL is still pending.`,
    dashboardHint: DASHBOARD,
  };
}
