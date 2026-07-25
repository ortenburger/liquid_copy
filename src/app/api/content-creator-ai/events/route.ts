/**
 * GET /api/content-creator-ai/events — Server-Sent Events stream (Task 10.2).
 * Requirements 12.3, 12.6.
 *
 * Bridges two sources into one stream:
 *  - the Event Bus (checkpoint events, KB updates, Firecrawl errors), and
 *  - the Workflow Engine's local listeners (stage transitions, progress).
 *
 * The engine's transitions are intentionally not on the Event Bus: its payload
 * map is Agent 1's shared contract, so this route merges the two rather than
 * widening it.
 *
 * All subscriptions are torn down when the client aborts, so a disconnect cannot
 * leak listeners onto the process-wide singletons.
 */
import { eventBus } from "@/lib/content-creator-ai/orchestration/event-bus.js";
import { getRuntime } from "@/lib/content-creator-ai/api/runtime.js";

/** Streamed event names, in the order a client will typically see them. */
const BUS_EVENTS = [
  "checkpoint.reached",
  "checkpoint.approved",
  "checkpoint.rejected",
  "checkpoint.timeout",
  "kb.updated",
  "knowledge_updated",
  "firecrawl.error",
] as const;

/** Heartbeat keeps intermediaries from closing an idle stream. */
const HEARTBEAT_MS = 15_000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const { workflow } = getRuntime();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const unsubscribes: Array<() => void> = [];
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          // Stream already torn down by the client.
          cleanup();
        }
      };

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        for (const off of unsubscribes) {
          try {
            off();
          } catch {
            // best effort
          }
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Event Bus → stream. Subscribers do not acknowledge: a slow client must
      // never hold up a publisher waiting on an ack.
      for (const name of BUS_EVENTS) {
        unsubscribes.push(
          eventBus.subscribe(
            name,
            (payload) => send(name, { event: name, payload }),
            { acknowledges: false },
          ),
        );
      }

      // Workflow Engine → stream.
      unsubscribes.push(
        workflow.subscribe((event) => send("workflow", event)),
      );

      request.signal.addEventListener("abort", cleanup);

      send("ready", {
        mode: workflow.getMode(),
        currentStage: workflow.currentStage(),
        streaming: [...BUS_EVENTS, "workflow"],
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);
      (heartbeat as unknown as { unref?: () => void }).unref?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so events arrive promptly.
      "X-Accel-Buffering": "no",
    },
  });
}
