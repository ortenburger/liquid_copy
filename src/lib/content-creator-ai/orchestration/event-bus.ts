import type { ApprovalCheckpointStage, KBEntityType } from "../types/enums.js";

/** Typed event name → payload map for the content-creator-ai Event Bus. */
export interface EventPayloads {
  "firecrawl.error": { url: string; reason: string };
  "kb.updated": {
    entityId: string;
    entityType: KBEntityType;
    version: number;
  };
  knowledge_updated: { experimentId: string; newEntryCount: number };
  "checkpoint.reached": {
    stage: ApprovalCheckpointStage;
    pendingOutput: unknown;
  };
  "checkpoint.approved": { stage: ApprovalCheckpointStage };
  "checkpoint.rejected": {
    stage: ApprovalCheckpointStage;
    instructions: string;
  };
  "checkpoint.timeout": { stage: ApprovalCheckpointStage };
}

export type EventName = keyof EventPayloads;

export type EventHandler<E extends EventName> = (
  payload: EventPayloads[E],
) => void | Promise<void>;

export interface PublishOptions {
  /** Acknowledgement timeout in ms. Default: 60_000. */
  ackTimeoutMs?: number;
  /** Require at least one subscriber to acknowledge. Default: false. */
  requireAck?: boolean;
}

export interface SubscribeOptions {
  /** When true, handler completion counts as acknowledgement. Default: true. */
  acknowledges?: boolean;
}

interface Subscription<E extends EventName> {
  handler: EventHandler<E>;
  acknowledges: boolean;
}

const DEFAULT_ACK_TIMEOUT_MS = 60_000;

/**
 * In-process typed pub/sub bus with optional acknowledgement timeouts.
 */
export class EventBus {
  private readonly subs = new Map<EventName, Set<Subscription<EventName>>>();
  private defaultAckTimeoutMs: number;

  constructor(defaultAckTimeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
    this.defaultAckTimeoutMs = defaultAckTimeoutMs;
  }

  setAckTimeout(ms: number): void {
    this.defaultAckTimeoutMs = ms;
  }

  subscribe<E extends EventName>(
    eventName: E,
    handler: EventHandler<E>,
    options: SubscribeOptions = {},
  ): () => void {
    const acknowledges = options.acknowledges !== false;
    const sub: Subscription<EventName> = {
      handler: handler as EventHandler<EventName>,
      acknowledges,
    };
    let set = this.subs.get(eventName);
    if (!set) {
      set = new Set();
      this.subs.set(eventName, set);
    }
    set.add(sub);
    return () => {
      set!.delete(sub);
      if (set!.size === 0) this.subs.delete(eventName);
    };
  }

  /**
   * Publish an event. When `requireAck` is true, waits for acknowledging
   * subscribers (or times out after `ackTimeoutMs`).
   */
  async publish<E extends EventName>(
    eventName: E,
    payload: EventPayloads[E],
    options: PublishOptions = {},
  ): Promise<{ acknowledged: boolean; timedOut: boolean }> {
    const requireAck = options.requireAck === true;
    const timeoutMs = options.ackTimeoutMs ?? this.defaultAckTimeoutMs;
    const set = this.subs.get(eventName);

    if (!set || set.size === 0) {
      return { acknowledged: !requireAck, timedOut: false };
    }

    const invocations = [...set].map((sub) => ({
      promise: Promise.resolve().then(() =>
        (sub.handler as EventHandler<E>)(payload),
      ),
      acknowledges: sub.acknowledges,
    }));

    if (!requireAck) {
      await Promise.allSettled(invocations.map((i) => i.promise));
      return { acknowledged: true, timedOut: false };
    }

    const ackPromises = invocations
      .filter((i) => i.acknowledges)
      .map((i) => i.promise);
    const otherPromises = invocations
      .filter((i) => !i.acknowledges)
      .map((i) => i.promise);

    void Promise.allSettled(otherPromises);

    if (ackPromises.length === 0) {
      return { acknowledged: false, timedOut: false };
    }

    const timeout = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    });

    const result = await Promise.race([
      Promise.all(ackPromises).then(() => "acked" as const),
      timeout,
    ]);

    return {
      acknowledged: result === "acked",
      timedOut: result === "timeout",
    };
  }

  /** Remove all subscriptions (useful in tests). */
  clear(): void {
    this.subs.clear();
  }

  listenerCount(eventName: EventName): number {
    return this.subs.get(eventName)?.size ?? 0;
  }
}

/** Singleton Event Bus used across all agents. */
export const eventBus = new EventBus();
