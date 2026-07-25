import type { ZernioMetrics } from "../types/index.js";

export const ZERNIO_METRIC_KEYS = [
  "impressions",
  "ctr",
  "saves",
  "shares",
  "comments",
  "watchTime",
  "conversions",
  "engagementRate",
  "followerGrowth",
] as const satisfies readonly (keyof ZernioMetrics)[];

export type ZernioMetricKey = (typeof ZERNIO_METRIC_KEYS)[number];

export interface ZernioFetchResult {
  ok: true;
  metrics: ZernioMetrics;
  presentCount: number;
}

export interface ZernioFetchError {
  ok: false;
  reason: "partial_data" | "api_error" | "timeout";
  message: string;
  presentCount: number;
  partialMetrics?: Partial<ZernioMetrics>;
  retryCount: number;
}

export type ZernioResult = ZernioFetchResult | ZernioFetchError;

export interface ZernioAdapterOptions {
  /** Observation window in days (1–30, default 7). */
  observationWindowDays?: number;
  /** Inject fetch implementation (tests). */
  fetchMetrics?: (
    postVariantId: string,
  ) => Promise<Partial<ZernioMetrics> | null>;
  /** Clock. */
  now?: () => number;
  /** Sleep for retry scheduling. */
  sleep?: (ms: number) => Promise<void>;
  /** Notification sink. */
  notify?: (message: string) => void;
  /** Override retry delay (default 1 hour). */
  retryDelayMs?: number;
  maxRetries?: number;
}

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_RETRY_DELAY_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_RETRIES = 3;
const MIN_METRICS_REQUIRED = 5;

export function clampObservationWindowDays(days: number | undefined): number {
  const d = days ?? DEFAULT_WINDOW_DAYS;
  return Math.max(1, Math.min(30, Math.floor(d)));
}

/**
 * Count how many of the 9 required metrics are present (finite numbers).
 */
export function countPresentMetrics(
  partial: Partial<ZernioMetrics> | null | undefined,
): number {
  if (!partial) return 0;
  let count = 0;
  for (const key of ZERNIO_METRIC_KEYS) {
    const v = partial[key];
    if (typeof v === "number" && Number.isFinite(v)) count += 1;
  }
  return count;
}

export function isCompleteMetrics(
  partial: Partial<ZernioMetrics>,
): partial is ZernioMetrics {
  return countPresentMetrics(partial) === ZERNIO_METRIC_KEYS.length;
}

function fillDefaults(partial: Partial<ZernioMetrics>): ZernioMetrics {
  return {
    impressions: partial.impressions ?? 0,
    ctr: partial.ctr ?? 0,
    saves: partial.saves ?? 0,
    shares: partial.shares ?? 0,
    comments: partial.comments ?? 0,
    watchTime: partial.watchTime ?? 0,
    conversions: partial.conversions ?? 0,
    engagementRate: partial.engagementRate ?? 0,
    followerGrowth: partial.followerGrowth ?? 0,
  };
}

async function defaultFetch(
  postVariantId: string,
): Promise<Partial<ZernioMetrics> | null> {
  const base = process.env.ZERNIO_API_BASE?.replace(/\/$/, "");
  const key = process.env.ZERNIO_API_KEY;
  if (!base || !key) {
    throw new Error("Zernio credentials unavailable");
  }
  const res = await fetch(`${base}/metrics/${postVariantId}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Zernio API error: ${res.status}`);
  return (await res.json()) as Partial<ZernioMetrics>;
}

export class ZernioAdapter {
  readonly observationWindowDays: number;
  private readonly fetchMetrics: (
    postVariantId: string,
  ) => Promise<Partial<ZernioMetrics> | null>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly notify: (message: string) => void;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;

  constructor(options: ZernioAdapterOptions = {}) {
    this.observationWindowDays = clampObservationWindowDays(
      options.observationWindowDays,
    );
    this.fetchMetrics = options.fetchMetrics ?? defaultFetch;
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ??
      ((ms) =>
        ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
    this.notify = options.notify ?? (() => undefined);
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * True when observation window has elapsed since publish timestamp.
   */
  isObservationWindowElapsed(publishedAt: string): boolean {
    const publishedMs = Date.parse(publishedAt);
    if (!Number.isFinite(publishedMs)) return false;
    const elapsedDays = (this.now() - publishedMs) / (24 * 60 * 60 * 1000);
    return elapsedDays >= this.observationWindowDays;
  }

  /**
   * Poll Zernio for metrics. On partial data (< 5 of 9) → retry after 1h,
   * notify after 3 failed retries. Requirements 10.1, 10.5.
   */
  async fetchWithRetry(postVariantId: string): Promise<ZernioResult> {
    let retryCount = 0;
    let lastPartial: Partial<ZernioMetrics> | undefined;
    let lastPresent = 0;

    while (retryCount <= this.maxRetries) {
      try {
        const partial = await this.fetchMetrics(postVariantId);
        const presentCount = countPresentMetrics(partial);

        if (presentCount < MIN_METRICS_REQUIRED) {
          lastPartial = partial ?? undefined;
          lastPresent = presentCount;
          retryCount += 1;
          if (retryCount > this.maxRetries) {
            this.notify(
              `Zernio partial/incomplete data for ${postVariantId} after ${this.maxRetries} retries (${presentCount}/9 metrics)`,
            );
            return {
              ok: false,
              reason: "partial_data",
              message: `Fewer than ${MIN_METRICS_REQUIRED} of 9 metrics returned`,
              presentCount,
              partialMetrics: lastPartial,
              retryCount,
            };
          }
          await this.sleep(this.retryDelayMs);
          continue;
        }

        // ≥ 5 metrics present — accept, filling missing with 0
        const metrics = fillDefaults(partial ?? {});
        return { ok: true, metrics, presentCount };
      } catch (err) {
        retryCount += 1;
        const message = err instanceof Error ? err.message : String(err);
        if (retryCount > this.maxRetries) {
          this.notify(
            `Zernio error for ${postVariantId} after ${this.maxRetries} retries: ${message}`,
          );
          return {
            ok: false,
            reason: "api_error",
            message,
            presentCount: lastPresent,
            partialMetrics: lastPartial,
            retryCount,
          };
        }
        await this.sleep(this.retryDelayMs);
      }
    }

    return {
      ok: false,
      reason: "api_error",
      message: "Exhausted retries",
      presentCount: lastPresent,
      partialMetrics: lastPartial,
      retryCount,
    };
  }
}
