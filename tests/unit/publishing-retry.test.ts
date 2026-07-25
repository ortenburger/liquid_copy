import { describe, test, expect, vi } from "vitest";
import {
  PublishingQueue,
  RETRY_BACKOFF_MS,
  MAX_PUBLISH_ATTEMPTS,
  computeRetainUntil,
  getRetryScheduleMs,
} from "../../src/lib/content-creator-ai/publishing/queue.js";
import type {
  PlatformAdapter,
} from "../../src/lib/content-creator-ai/publishing/adapters/types.js";
import { createStubPublishRecord } from "../../src/lib/content-creator-ai/publishing/adapters/types.js";
import type { PostVariant, TraceabilityChain } from "../../src/lib/content-creator-ai/types/index.js";

function emptyTrace(id: string): TraceabilityChain {
  return {
    companyContextVersionId: "c",
    marketingGoalId: "g",
    audiencePersonaId: "a",
    roadmapEntryId: "r",
    hypothesisId: "h",
    postVariantId: id,
    status: "in_progress",
    links: [],
  };
}

function makeVariant(id = "pv-1"): PostVariant {
  return {
    id,
    hypothesisId: "hyp-1",
    platform: "instagram",
    carouselId: "car-1",
    slides: [
      {
        id: "s1",
        html: "<p>hi</p>",
        order: 0,
        hasImage: false,
        hasText: true,
      },
    ],
    caption: "hello world",
    hashtags: ["test"],
    aspectRatio: "4:5",
    regenerationRetryCount: 0,
    validationStatus: "valid",
    status: "draft",
    traceability: emptyTrace(id),
  };
}

describe("Publishing retry schedule", () => {
  test("attempt schedule is immediate → +1 min → +2 min → +4 min", () => {
    expect([...getRetryScheduleMs()]).toEqual([0, 60_000, 120_000, 240_000]);
    expect(RETRY_BACKOFF_MS).toHaveLength(MAX_PUBLISH_ATTEMPTS);
  });

  test("marks failed after 4 attempts and sets 30-day retention", async () => {
    const delays: number[] = [];
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const failingAdapter: PlatformAdapter = {
      platform: "instagram",
      async publish() {
        throw new Error("API error");
      },
    };

    const queue = new PublishingQueue({
      adapters: { instagram: failingAdapter },
      now: () => now,
      sleep: async (ms) => {
        delays.push(ms);
      },
      notify: () => undefined,
      mode: "Full_Auto_Mode",
    });

    queue.enqueue([makeVariant()]);
    const results = await queue.processAll();

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].retryAttempts).toBe(MAX_PUBLISH_ATTEMPTS);
    expect(results[0].retainUntil).toBe(computeRetainUntil(now));
    expect(delays).toEqual([0, 60_000, 120_000, 240_000]);
    expect(queue.attemptLog).toHaveLength(4);
    expect(queue.attemptLog.every((a) => !a.success)).toBe(true);
  });

  test("succeeds on 4th attempt after 3 failures with correct backoff", async () => {
    const delays: number[] = [];
    let calls = 0;
    const flaky: PlatformAdapter = {
      platform: "instagram",
      async publish(variant) {
        calls += 1;
        if (calls < 4) throw new Error("transient");
        return createStubPublishRecord(variant, {
          status: "published",
          publishedAt: new Date().toISOString(),
        });
      },
    };

    const queue = new PublishingQueue({
      adapters: { instagram: flaky },
      sleep: async (ms) => {
        delays.push(ms);
      },
      mode: "Full_Auto_Mode",
    });

    queue.enqueue([makeVariant()]);
    const results = await queue.processAll();

    expect(results[0].status).toBe("published");
    expect(delays).toEqual([0, 60_000, 120_000, 240_000]);
    expect(calls).toBe(4);
  });

  test("empty queue does not trigger HITL approval prompt", async () => {
    const approval = vi.fn(async () => true);
    const queue = new PublishingQueue({
      mode: "Human_In_The_Loop_Mode",
      requestPublishingApproval: approval,
    });

    const approved = await queue.maybeRequestHitlApproval();
    expect(approved).toBe(true);
    expect(approval).not.toHaveBeenCalled();
  });

  test("non-empty queue triggers HITL approval in HITL mode", async () => {
    const approval = vi.fn(async () => true);
    const success: PlatformAdapter = {
      platform: "instagram",
      async publish(variant) {
        return createStubPublishRecord(variant, {
          status: "published",
          publishedAt: new Date().toISOString(),
        });
      },
    };
    const queue = new PublishingQueue({
      adapters: { instagram: success },
      mode: "Human_In_The_Loop_Mode",
      requestPublishingApproval: approval,
      sleep: async () => undefined,
    });

    queue.enqueue([makeVariant()]);
    await queue.processAll();
    expect(approval).toHaveBeenCalledOnce();
  });
});
