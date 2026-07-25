/**
 * API layer integration tests (Task 10.3).
 * Feature: content-creator-ai
 * Requirements 13.2 (traceability ≤ 3s), 14.5 (manual search ≤ 10 results, ≤ 3s),
 * plus the route contracts from Task 10.1 and the SSE stream from Task 10.2.
 *
 * The route handlers are invoked directly with Web-standard Request objects — the
 * same signature Next.js passes them — so no server is required.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KBDocument } from "@/lib/content-creator-ai/types/index.js";
import {
  resetRuntime,
  getRuntime,
  MAX_SEARCH_RESULTS,
} from "@/lib/content-creator-ai/api/runtime.js";
import {
  resetVectorStore,
  indexDocuments,
} from "@/lib/content-creator-ai/rag/vectorstore.js";
import { eventBus } from "@/lib/content-creator-ai/orchestration/event-bus.js";
import {
  setLLMClient,
  resetLLMClient,
  UnavailableLLMClient,
} from "@/lib/content-creator-ai/integrations/llm.js";
import { TRACE_STAGES } from "@/lib/content-creator-ai/api/traceability.js";
import { writeKBEntity } from "@/lib/content-creator-ai/kb/storage.js";

import { POST as searchRoute } from "@/app/api/content-creator-ai/search/route.js";
import { GET as traceabilityRoute } from "@/app/api/content-creator-ai/traceability/[variantId]/route.js";
import {
  GET as kbRead,
  PUT as kbWrite,
} from "@/app/api/content-creator-ai/knowledge-base/route.js";
import {
  GET as platformsGet,
  POST as platformsPost,
} from "@/app/api/content-creator-ai/platform-selection/route.js";
import {
  GET as workflowStatusRoute,
  PUT as workflowModeRoute,
} from "@/app/api/content-creator-ai/workflow/status/route.js";
import { POST as checkpointRoute } from "@/app/api/content-creator-ai/checkpoints/[stage]/[action]/route.js";
import { POST as ingestRoute } from "@/app/api/content-creator-ai/ingest/route.js";
import { GET as eventsRoute } from "@/app/api/content-creator-ai/events/route.js";

const BASE = "http://localhost:3000/api/content-creator-ai";

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Parse a route response body. `Response.json()` is typed `unknown`, and these
 * payloads are deliberately dynamic, so assertions read against a loose shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(response: Response): Promise<any> {
  return response.json();
}

/** Build `count` indexable documents so search has a populated corpus. */
function makeDocs(count: number): KBDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${i}`,
    entityId: `entity-${i}`,
    entityType: "experiment" as const,
    scope: "experiment_history" as const,
    content: `experiment ${i} learned that short hooks about pricing outperform long ones`,
  }));
}

describe("content-creator-ai API", () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = mkdtempSync(join(tmpdir(), "api-int-"));
    process.env.KB_STORAGE_PATH = storagePath;
    process.env.RAG_FORCE_LOCAL_EMBED = "1";
    setLLMClient(new UnavailableLLMClient());
    eventBus.clear();
    resetVectorStore();
    resetRuntime();
  });

  afterEach(() => {
    resetLLMClient();
    eventBus.clear();
    delete process.env.KB_STORAGE_PATH;
    delete process.env.RAG_FORCE_LOCAL_EMBED;
    rmSync(storagePath, { recursive: true, force: true });
  });

  // ---- Requirement 14.5: manual knowledge search ----

  test("manual search returns at most 10 results within 3 seconds", async () => {
    // Index well above the cap so truncation is actually exercised.
    await indexDocuments(makeDocs(40));

    const startedAt = Date.now();
    const response = await searchRoute(
      jsonRequest(`${BASE}/search`, "POST", {
        query: "which hooks performed best",
      }),
    );
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(200);
    const body = await readJson(response);

    expect(body.results.length).toBeLessThanOrEqual(MAX_SEARCH_RESULTS);
    expect(body.results.length).toBe(MAX_SEARCH_RESULTS);
    expect(body.count).toBe(body.results.length);
    expect(body.maxResults).toBe(10);

    // Requirement 14.5 — 3 second SLA.
    expect(elapsed).toBeLessThan(3000);
    expect(body.durationMs).toBeLessThan(3000);
  });

  test("a requested limit above 10 is clamped to 10", async () => {
    await indexDocuments(makeDocs(40));
    const response = await searchRoute(
      jsonRequest(`${BASE}/search`, "POST", { query: "hooks", limit: 50 }),
    );
    const body = await readJson(response);
    expect(body.results.length).toBe(10);
  });

  test("a smaller requested limit is honoured", async () => {
    await indexDocuments(makeDocs(40));
    const response = await searchRoute(
      jsonRequest(`${BASE}/search`, "POST", { query: "hooks", limit: 3 }),
    );
    const body = await readJson(response);
    expect(body.results.length).toBe(3);
  });

  test("search on an empty index returns no results rather than erroring", async () => {
    const response = await searchRoute(
      jsonRequest(`${BASE}/search`, "POST", { query: "anything" }),
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.results).toEqual([]);
    expect(body.empty).toBe(true);
  });

  test("search respects the retrieval scope filter", async () => {
    await indexDocuments([
      {
        id: "d1",
        entityId: "e1",
        entityType: "company_identity",
        scope: "company_memory",
        content: "our brand voice is direct and warm",
      },
      {
        id: "d2",
        entityId: "e2",
        entityType: "experiment",
        scope: "experiment_history",
        content: "experiment nine used a question hook",
      },
    ]);

    const response = await searchRoute(
      jsonRequest(`${BASE}/search`, "POST", {
        query: "brand voice",
        scope: "company_memory",
      }),
    );
    const body = await readJson(response);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].scope).toBe("company_memory");
  });

  test("search rejects a missing query and an unknown scope", async () => {
    expect(
      (await searchRoute(jsonRequest(`${BASE}/search`, "POST", {}))).status,
    ).toBe(400);
    expect(
      (await searchRoute(jsonRequest(`${BASE}/search`, "POST", { query: "  " })))
        .status,
    ).toBe(400);
    expect(
      (
        await searchRoute(
          jsonRequest(`${BASE}/search`, "POST", { query: "x", scope: "nope" }),
        )
      ).status,
    ).toBe(400);
  });

  test("search rejects a malformed JSON body", async () => {
    const response = await searchRoute(
      new Request(`${BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  // ---- Requirement 13.2: traceability ----

  test("a fully-evaluated variant's chain returns within 3 seconds", async () => {
    const { traceability } = getRuntime();
    const variantId = "variant-under-test";

    // Populate many chains so the lookup is not trivially small.
    for (let i = 0; i < 500; i++) {
      for (const stage of TRACE_STAGES) {
        traceability.record(`filler-${i}`, stage, `${stage}-${i}`);
      }
    }
    for (const stage of TRACE_STAGES) {
      traceability.record(variantId, stage, `${stage}-id`);
    }

    const startedAt = Date.now();
    const response = await traceabilityRoute(
      new Request(`${BASE}/traceability/${variantId}`),
      { params: Promise.resolve({ variantId }) },
    );
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(200);
    const body = await readJson(response);

    expect(body.status).toBe("complete");
    expect(body.chain.links).toHaveLength(TRACE_STAGES.length);
    expect(body.missingStages).toEqual([]);
    // Requirement 13.2 — 3 second SLA.
    expect(elapsed).toBeLessThan(3000);
    expect(body.durationMs).toBeLessThan(3000);
  });

  test("an in-progress variant returns a partial chain with its marker", async () => {
    const { traceability } = getRuntime();
    const variantId = "in-progress-variant";
    traceability.recordAll(variantId, {
      companyContextVersion: "ctx-1",
      marketingGoal: "goal-1",
      audiencePersona: "persona-1",
      roadmapEntry: "entry-1",
      hypothesis: "hyp-1",
      postVariant: variantId,
    });

    const response = await traceabilityRoute(
      new Request(`${BASE}/traceability/${variantId}`),
      { params: Promise.resolve({ variantId }) },
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.status).toBe("in_progress");
    expect(body.chain.links).toHaveLength(6);
    expect(body.missingStages).toContain("experimentEvaluation");
  });

  test("human edits are exposed on the traceability response", async () => {
    const { traceability } = getRuntime();
    const variantId = "edited-variant";
    traceability.record(variantId, "postVariant", variantId);
    traceability.recordHumanEdit({
      postVariantId: variantId,
      actor: "francois@gocohort.com",
      originalVersion: { caption: "ai" },
      editedVersion: { caption: "human" },
    });

    const response = await traceabilityRoute(
      new Request(`${BASE}/traceability/${variantId}`),
      { params: Promise.resolve({ variantId }) },
    );
    const body = await readJson(response);

    expect(body.humanEdits).toHaveLength(1);
    expect(body.humanEdits[0].actor).toBe("francois@gocohort.com");
    expect(body.humanEdits[0].originalVersion).toEqual({ caption: "ai" });
    expect(body.humanEdits[0].editedVersion).toEqual({ caption: "human" });
  });

  test("an unknown variant returns 404", async () => {
    const response = await traceabilityRoute(
      new Request(`${BASE}/traceability/nope`),
      { params: Promise.resolve({ variantId: "nope" }) },
    );
    expect(response.status).toBe(404);
    expect((await readJson(response)).found).toBe(false);
  });

  test("route params are accepted as a plain object too", async () => {
    const { traceability } = getRuntime();
    traceability.record("v-plain", "postVariant", "v-plain");
    const response = await traceabilityRoute(
      new Request(`${BASE}/traceability/v-plain`),
      { params: { variantId: "v-plain" } },
    );
    expect(response.status).toBe(200);
  });

  // ---- Knowledge base routes ----

  test("KB write then read round-trips through the routes", async () => {
    const markdown =
      "# Company_Identity\n\n## Name\nAcme\n\n## Mission\nShip faster\n\n## BrandVoice\ndirect\n\n# Products\n\n_empty_\n\n# Audiences\n\n_empty_\n\n# Experiments\n\n_empty_\n";

    const write = await kbWrite(
      jsonRequest(`${BASE}/knowledge-base`, "PUT", {
        entityId: "acme",
        entityType: "company_identity",
        markdown,
      }),
    );
    expect(write.status).toBe(200);
    const written = await readJson(write);
    expect(written.kbVersion).toBeTruthy();
    expect(written.versionNumber).toBe(1);

    const read = await kbRead(
      new Request(`${BASE}/knowledge-base?entityId=acme`),
    );
    expect(read.status).toBe(200);
    const body = await readJson(read);
    expect(body.found).toBe(true);
    expect(body.parsed.companyIdentity.name).toBe("Acme");
  });

  test("a scoped KB read narrows to the matching section", async () => {
    await writeKBEntity(
      {
        entityId: "persona-1",
        entityType: "audience",
        content: {
          audiences: [
            {
              id: "persona-1",
              icpDefinition: "founders",
              painPoints: ["no time"],
              jobsToBeDone: [],
              objections: [],
              dreamOutcomes: [],
              source: "ai_generated",
              kbVersion: "v1",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        emitEvent: false,
      },
      storagePath,
    );

    const response = await kbRead(
      new Request(
        `${BASE}/knowledge-base?entityId=persona-1&scope=audience_learning`,
      ),
    );
    const body = await readJson(response);
    expect(body.scope).toBe("audience_learning");
    expect(body.section).toHaveLength(1);
    expect(body.section[0].icpDefinition).toBe("founders");
  });

  test("KB routes validate their inputs", async () => {
    expect((await kbRead(new Request(`${BASE}/knowledge-base`))).status).toBe(400);
    expect(
      (await kbRead(new Request(`${BASE}/knowledge-base?entityId=x&scope=bad`)))
        .status,
    ).toBe(400);
    expect(
      (await kbRead(new Request(`${BASE}/knowledge-base?entityId=missing`)))
        .status,
    ).toBe(404);
    expect(
      (
        await kbWrite(
          jsonRequest(`${BASE}/knowledge-base`, "PUT", { entityId: "x" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await kbWrite(
          jsonRequest(`${BASE}/knowledge-base`, "PUT", {
            entityId: "x",
            entityType: "audience",
          }),
        )
      ).status,
    ).toBe(400);
  });

  // ---- Requirements 5.1, 5.2, 5.4: platform selection ----

  test("the supported channel list covers all nine platforms", async () => {
    const response = await platformsGet();
    const body = await readJson(response);
    expect(body.supported).toEqual([
      "instagram", "tiktok", "linkedin", "facebook", "pinterest",
      "etsy", "x", "threads", "youtube_shorts",
    ]);
  });

  test("selecting platforms replaces the previous set", async () => {
    let response = await platformsPost(
      jsonRequest(`${BASE}/platform-selection`, "POST", {
        platforms: ["instagram", "tiktok"],
      }),
    );
    expect(response.status).toBe(200);
    expect((await readJson(response)).selected).toEqual(["instagram", "tiktok"]);

    // Requirement 5.2 — replace, not merge.
    response = await platformsPost(
      jsonRequest(`${BASE}/platform-selection`, "POST", {
        platforms: ["linkedin"],
      }),
    );
    expect((await readJson(response)).selected).toEqual(["linkedin"]);
    expect(getRuntime().workflow.getSelectedPlatforms()).toEqual(["linkedin"]);
  });

  test("an empty selection is rejected with the 5.4 message", async () => {
    const response = await platformsPost(
      jsonRequest(`${BASE}/platform-selection`, "POST", { platforms: [] }),
    );
    expect(response.status).toBe(422);
    const body = await readJson(response);
    expect(body.ok).toBe(false);
    expect(body.message).toContain("At least one platform must be selected");
  });

  test("unsupported platforms are reported and dropped", async () => {
    const response = await platformsPost(
      jsonRequest(`${BASE}/platform-selection`, "POST", {
        platforms: ["instagram", "myspace", 42],
      }),
    );
    const body = await readJson(response);
    expect(body.selected).toEqual(["instagram"]);
    expect(body.invalid).toEqual(["myspace", "42"]);
  });

  test("duplicate platforms are de-duplicated", async () => {
    const response = await platformsPost(
      jsonRequest(`${BASE}/platform-selection`, "POST", {
        platforms: ["x", "x", "threads"],
      }),
    );
    expect((await readJson(response)).selected).toEqual(["x", "threads"]);
  });

  // ---- Workflow status and mode ----

  test("workflow status reports the FSM state, mode and checkpoints", async () => {
    const response = await workflowStatusRoute();
    expect(response.status).toBe(200);
    const body = await readJson(response);

    expect(body.mode).toBe("Human_In_The_Loop_Mode");
    expect(body.currentStage).toBe("ContextIngestion");
    expect(body.complete).toBe(false);
    expect(body.stages).toHaveLength(10);
    expect(body.checkpoints).toHaveLength(9);
    expect(body.selectedPlatforms).toEqual([]);
  });

  test("the mode can be switched through the route", async () => {
    const response = await workflowModeRoute(
      jsonRequest(`${BASE}/workflow/status`, "PUT", { mode: "Full_Auto_Mode" }),
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.mode).toBe("Full_Auto_Mode");
    expect(body.status.mode).toBe("Full_Auto_Mode");
  });

  test("an unknown mode is rejected", async () => {
    const response = await workflowModeRoute(
      jsonRequest(`${BASE}/workflow/status`, "PUT", { mode: "Turbo_Mode" }),
    );
    expect(response.status).toBe(400);
  });

  // ---- Checkpoint actions ----

  test("a bare rejection at a checkpoint returns 422", async () => {
    const { checkpoints } = getRuntime();
    await checkpoints.reach("ContextReview", { draft: 1 });

    const response = await checkpointRoute(
      jsonRequest(`${BASE}/checkpoints/ContextReview/reject`, "POST", {}),
      { params: Promise.resolve({ stage: "ContextReview", action: "reject" }) },
    );

    // Requirement 12.7.
    expect(response.status).toBe(422);
    const body = await readJson(response);
    expect(body.ok).toBe(false);
    expect(body.blockedMessage).toContain("free-text regeneration instructions");
  });

  test("a rejection with instructions is accepted", async () => {
    const { checkpoints } = getRuntime();
    await checkpoints.reach("ContextReview", { draft: 1 });

    const response = await checkpointRoute(
      jsonRequest(`${BASE}/checkpoints/ContextReview/reject`, "POST", {
        instructions: "Try a warmer tone",
      }),
      { params: Promise.resolve({ stage: "ContextReview", action: "reject" }) },
    );
    expect(response.status).toBe(200);
    expect((await readJson(response)).ok).toBe(true);
  });

  test("approving a waiting checkpoint succeeds", async () => {
    const { checkpoints } = getRuntime();
    await checkpoints.reach("GoalReview", { draft: 1 });

    const response = await checkpointRoute(
      jsonRequest(`${BASE}/checkpoints/GoalReview/approve`, "POST", {}),
      { params: Promise.resolve({ stage: "GoalReview", action: "approve" }) },
    );
    expect(response.status).toBe(200);
    expect((await readJson(response)).state.status).toBe("approved");
  });

  test("disabling the last enabled checkpoint returns 409", async () => {
    const { checkpoints } = getRuntime();
    // Leave exactly one enabled.
    checkpoints.bulkDisable([
      "GoalReview", "AudienceReview", "RoadmapReview", "HypothesisReview",
      "ContentReview", "PublishingApproval", "ExperimentReview",
      "NextIterationPlanning",
    ]);
    expect(checkpoints.enabledCount()).toBe(1);

    const response = await checkpointRoute(
      jsonRequest(`${BASE}/checkpoints/ContextReview/disable`, "POST", {}),
      { params: Promise.resolve({ stage: "ContextReview", action: "disable" }) },
    );

    // Requirement 12.9.
    expect(response.status).toBe(409);
    expect(checkpoints.enabledCount()).toBe(1);
  });

  test("unknown stages and actions return 404", async () => {
    expect(
      (
        await checkpointRoute(
          jsonRequest(`${BASE}/checkpoints/Nope/approve`, "POST", {}),
          { params: Promise.resolve({ stage: "Nope", action: "approve" }) },
        )
      ).status,
    ).toBe(404);

    expect(
      (
        await checkpointRoute(
          jsonRequest(`${BASE}/checkpoints/ContextReview/detonate`, "POST", {}),
          {
            params: Promise.resolve({
              stage: "ContextReview",
              action: "detonate",
            }),
          },
        )
      ).status,
    ).toBe(404);
  });

  test("acting on a checkpoint that is not waiting returns 409", async () => {
    const response = await checkpointRoute(
      jsonRequest(`${BASE}/checkpoints/ContextReview/approve`, "POST", {}),
      { params: Promise.resolve({ stage: "ContextReview", action: "approve" }) },
    );
    expect(response.status).toBe(409);
  });

  // ---- Ingest route ----

  test("the ingest route reports no_change for an empty body", async () => {
    const response = await ingestRoute(
      jsonRequest(`${BASE}/ingest`, "POST", {}),
    );
    expect(response.status).toBe(200);
    expect((await readJson(response)).status).toBe("no_change");
  });

  test("the ingest route surfaces recovery options without closures", async () => {
    // No Firecrawl key or reachable host, so this exercises the error path.
    const response = await ingestRoute(
      jsonRequest(`${BASE}/ingest`, "POST", {
        companyUrl: "http://127.0.0.1:9/unreachable",
      }),
    );
    const body = await readJson(response);

    expect(body.status).toBe("firecrawl_error");
    expect(body.recovery.options).toEqual(["retry", "qa_pipeline"]);
    // Closures must not be serialised into the response.
    expect(body.recovery.retry).toBeUndefined();
    expect(body.recovery.startQAPipeline).toBeUndefined();
  });

  test("draft actions require a draftId", async () => {
    for (const action of ["accept", "edit", "reject"]) {
      const response = await ingestRoute(
        jsonRequest(`${BASE}/ingest`, "POST", { action }),
      );
      expect(response.status).toBe(400);
    }
  });

  // ---- Requirement 12.3 / 12.6: SSE stream ----

  test("the SSE stream emits a ready frame then bus and workflow events", async () => {
    const controller = new AbortController();
    const response = await eventsRoute(
      new Request(`${BASE}/events`, { signal: controller.signal }),
    );

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const first = await reader.read();
    const readyFrame = decoder.decode(first.value);
    expect(readyFrame).toContain("event: ready");
    expect(readyFrame).toContain("Human_In_The_Loop_Mode");

    // A checkpoint event on the bus reaches the stream.
    await eventBus.publish("checkpoint.reached", {
      stage: "GoalReview",
      pendingOutput: { draft: true },
    });
    const busFrame = decoder.decode((await reader.read()).value);
    expect(busFrame).toContain("event: checkpoint.reached");
    expect(busFrame).toContain("GoalReview");

    // A workflow transition also reaches the stream.
    getRuntime().workflow.setMode("Full_Auto_Mode");
    const workflowFrame = decoder.decode((await reader.read()).value);
    expect(workflowFrame).toContain("event: workflow");
    expect(workflowFrame).toContain("mode_changed");

    controller.abort();
    reader.cancel().catch(() => {});
  });

  test("aborting the SSE request unsubscribes from the bus", async () => {
    const before = eventBus.listenerCount("checkpoint.reached");

    const controller = new AbortController();
    const response = await eventsRoute(
      new Request(`${BASE}/events`, { signal: controller.signal }),
    );
    const reader = response.body!.getReader();
    await reader.read(); // ready frame

    expect(eventBus.listenerCount("checkpoint.reached")).toBe(before + 1);

    controller.abort();
    // Give the abort listener a turn to run.
    await new Promise((r) => setTimeout(r, 10));

    // No listener leak on the process-wide singleton.
    expect(eventBus.listenerCount("checkpoint.reached")).toBe(before);
    reader.cancel().catch(() => {});
  });
});
