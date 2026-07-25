import type {
  OperatingMode,
  PostVariant,
  PublishRecord,
  SocialPlatform,
} from "../types/index.js";
import type { PlatformAdapter } from "./adapters/types.js";
import { getPlatformAdapter } from "./adapters/index.js";
import { createStubPublishRecord } from "./adapters/types.js";

/** Retry delays in ms after each failed attempt (attempts 2–4). */
export const RETRY_BACKOFF_MS = [
  0, // Attempt 1: immediate
  60_000, // Attempt 2: +1 minute
  120_000, // Attempt 3: +2 minutes
  240_000, // Attempt 4: +4 minutes (final)
] as const;

export const MAX_PUBLISH_ATTEMPTS = 4;
export const RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface QueuedPublishItem {
  variant: PostVariant;
  record: PublishRecord;
  attemptDelaysMs: number[];
}

export interface PublishQueueOptions {
  /** Inject adapters (tests). */
  adapters?: Partial<Record<SocialPlatform, PlatformAdapter>>;
  /** Clock for deterministic tests. */
  now?: () => number;
  /** Sleep implementation (tests can no-op / track delays). */
  sleep?: (ms: number) => Promise<void>;
  /** Notification sink. */
  notify?: (message: string) => void;
  /** Operating mode — HITL pauses at PublishingApproval when queue non-empty. */
  mode?: OperatingMode;
  /** Called when HITL approval is required. Return true to approve. */
  requestPublishingApproval?: (batch: QueuedPublishItem[]) => Promise<boolean>;
}

export interface PublishAttemptLog {
  postVariantId: string;
  attempt: number;
  delayMs: number;
  success: boolean;
  error?: string;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute retainUntil = now + 30 days (Requirement 9.6).
 */
export function computeRetainUntil(nowMs: number): string {
  return new Date(nowMs + RETENTION_DAYS * MS_PER_DAY).toISOString();
}

/**
 * Next available scheduling slot within 24 hours (simple round-robin per platform).
 */
export function nextAvailableSlot(
  platform: SocialPlatform,
  nowMs: number,
  occupied: Map<SocialPlatform, number[]>,
): string {
  const occupiedTimes = occupied.get(platform) ?? [];
  const windowEnd = nowMs + MS_PER_DAY;
  // Slots every 30 minutes
  const SLOT_MS = 30 * 60 * 1000;
  let candidate = nowMs + SLOT_MS;
  while (candidate <= windowEnd) {
    if (!occupiedTimes.some((t) => Math.abs(t - candidate) < SLOT_MS / 2)) {
      occupiedTimes.push(candidate);
      occupied.set(platform, occupiedTimes);
      return new Date(candidate).toISOString();
    }
    candidate += SLOT_MS;
  }
  // Fall back to now + 1h if window packed
  const fallback = nowMs + 60 * 60 * 1000;
  occupiedTimes.push(fallback);
  occupied.set(platform, occupiedTimes);
  return new Date(fallback).toISOString();
}

export class PublishingQueue {
  private readonly items: QueuedPublishItem[] = [];
  private readonly occupiedSlots = new Map<SocialPlatform, number[]>();
  private readonly adapters: Partial<Record<SocialPlatform, PlatformAdapter>>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly notify: (message: string) => void;
  private mode: OperatingMode;
  private readonly requestPublishingApproval?: (
    batch: QueuedPublishItem[],
  ) => Promise<boolean>;
  readonly attemptLog: PublishAttemptLog[] = [];

  constructor(options: PublishQueueOptions = {}) {
    this.adapters = options.adapters ?? {};
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.notify = options.notify ?? (() => undefined);
    this.mode = options.mode ?? "Full_Auto_Mode";
    this.requestPublishingApproval = options.requestPublishingApproval;
  }

  setMode(mode: OperatingMode): void {
    this.mode = mode;
  }

  get size(): number {
    return this.items.length;
  }

  getQueue(): readonly QueuedPublishItem[] {
    return this.items;
  }

  /**
   * Queue approved variants with default schedule = next slot within 24h.
   * Requirement 9.1.
   */
  enqueue(
    variants: PostVariant[],
    scheduleOverride?: string,
  ): QueuedPublishItem[] {
    const queued: QueuedPublishItem[] = [];
    for (const variant of variants) {
      const scheduledAt =
        scheduleOverride ??
        nextAvailableSlot(variant.platform, this.now(), this.occupiedSlots);
      const record = createStubPublishRecord(variant, {
        scheduledAt,
        status: "queued",
        retryAttempts: 0,
      });
      const item: QueuedPublishItem = {
        variant: { ...variant, status: "queued" },
        record,
        attemptDelaysMs: [],
      };
      this.items.push(item);
      queued.push(item);
    }
    return queued;
  }

  /**
   * HITL: pause at PublishingApproval only when queue is non-empty.
   * Requirement 9.4.
   */
  async maybeRequestHitlApproval(): Promise<boolean> {
    if (this.mode !== "Human_In_The_Loop_Mode") return true;
    if (this.items.length === 0) {
      // Empty queue — do not prompt
      return true;
    }
    if (!this.requestPublishingApproval) {
      this.notify(
        "HITL PublishingApproval required but no approval handler configured",
      );
      return false;
    }
    return this.requestPublishingApproval([...this.items]);
  }

  /**
   * Process the queue with exponential backoff retry.
   * Attempts: immediate → +1m → +2m → +4m; then failed + 30-day retention.
   * Requirements 9.2, 9.5, 9.6.
   */
  async processAll(): Promise<PublishRecord[]> {
    const approved = await this.maybeRequestHitlApproval();
    if (!approved) {
      this.notify("Publishing paused — awaiting human approval");
      return this.items.map((i) => i.record);
    }

    const results: PublishRecord[] = [];
    // Snapshot so we can clear as we go
    const pending = [...this.items];
    this.items.length = 0;

    for (const item of pending) {
      const record = await this.publishWithRetry(item);
      results.push(record);
    }
    return results;
  }

  async publishWithRetry(item: QueuedPublishItem): Promise<PublishRecord> {
    const adapter =
      this.adapters[item.variant.platform] ??
      getPlatformAdapter(item.variant.platform);

    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt++) {
      const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? 0;
      item.attemptDelaysMs.push(delayMs);
      // Always invoke sleep (including 0) so attempt schedule is observable in tests
      await this.sleep(delayMs);

      item.record.status = attempt === 1 ? "queued" : "retrying";
      item.record.retryAttempts = attempt - 1;

      try {
        const published = await adapter.publish(item.variant);
        const publishedAt = published.publishedAt ?? new Date(this.now()).toISOString();
        item.record = {
          ...published,
          id: published.id || item.record.id,
          postVariantId: item.variant.id,
          hypothesisId: item.variant.hypothesisId,
          platform: item.variant.platform,
          scheduledAt: item.record.scheduledAt,
          publishedAt,
          status: "published",
          retryAttempts: attempt - 1,
        };
        item.variant.status = "published";
        item.variant.publishedAt = publishedAt;

        this.attemptLog.push({
          postVariantId: item.variant.id,
          attempt,
          delayMs,
          success: true,
        });
        return item.record;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.attemptLog.push({
          postVariantId: item.variant.id,
          attempt,
          delayMs,
          success: false,
          error: lastError,
        });
      }
    }

    // All 4 attempts failed
    const retainUntil = computeRetainUntil(this.now());
    item.record.status = "failed";
    item.record.retryAttempts = MAX_PUBLISH_ATTEMPTS;
    item.record.retainUntil = retainUntil;
    item.variant.status = "failed";
    item.variant.retainUntil = retainUntil;

    this.notify(
      `Publish failed for variant ${item.variant.id} after ${MAX_PUBLISH_ATTEMPTS} attempts: ${lastError ?? "unknown"}. Retained until ${retainUntil}.`,
    );
    return item.record;
  }

  /**
   * Manual retry within retention window (Requirement 9.6).
   */
  async manualRetry(item: QueuedPublishItem): Promise<PublishRecord> {
    const now = this.now();
    if (item.record.retainUntil && Date.parse(item.record.retainUntil) < now) {
      this.notify(`Retention expired for ${item.variant.id}`);
      return item.record;
    }
    item.record.retryAttempts = 0;
    item.record.status = "queued";
    item.attemptDelaysMs = [];
    return this.publishWithRetry(item);
  }
}

/**
 * Expected delay schedule for unit tests: [0, 60000, 120000, 240000].
 */
export function getRetryScheduleMs(): readonly number[] {
  return RETRY_BACKOFF_MS;
}
