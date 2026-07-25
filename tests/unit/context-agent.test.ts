/**
 * Context_Agent error-path unit tests (Task 5.4).
 * Feature: content-creator-ai
 * Requirements 1.4 (Firecrawl error → retry | Q&A, non-blocking), 1.7 (rejection
 * leaves the KB untouched), plus the 10-step Q&A progression.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContextAgent } from "@/lib/content-creator-ai/agents/context-agent/index.js";
import {
  QAPipeline,
  QA_STEPS,
  MAX_QA_PROMPTS,
  splitListAnswer,
} from "@/lib/content-creator-ai/agents/context-agent/qa-pipeline.js";
import { FirecrawlAdapter } from "@/lib/content-creator-ai/integrations/firecrawl.js";
import { eventBus } from "@/lib/content-creator-ai/orchestration/event-bus.js";
import {
  setLLMClient,
  resetLLMClient,
  UnavailableLLMClient,
} from "@/lib/content-creator-ai/integrations/llm.js";
import { writeKBEntity } from "@/lib/content-creator-ai/kb/storage.js";

/** Recursive byte-for-byte fingerprint of the whole KB directory. */
function fingerprintTree(root: string): string {
  const walk = (dir: string, prefix = ""): string[] => {
    const out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return out;
    }
    for (const name of entries) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        out.push(...walk(full, rel));
      } else {
        out.push(`${rel}:${readFileSync(full, "utf8")}`);
      }
    }
    return out;
  };
  return walk(root).join("\n");
}

/** Firecrawl stub that always fails. */
function failingFirecrawl(): FirecrawlAdapter {
  return new FirecrawlAdapter({
    baseUrl: "https://firecrawl.test",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "unreachable host" }), {
        status: 502,
        statusText: "Bad Gateway",
      }),
  });
}

/** Firecrawl stub that returns one usable page. */
function workingFirecrawl(): FirecrawlAdapter {
  return new FirecrawlAdapter({
    baseUrl: "https://firecrawl.test",
    pollIntervalMs: 1,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/crawl")) {
        return new Response(JSON.stringify({ id: "job-1", success: true }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          status: "completed",
          data: [
            {
              markdown:
                "# Acme Tools\n\nOur mission is to help small studios ship faster.\n\n## Products\n\n- Widget Pro\n- Widget Lite\n",
              metadata: { sourceURL: "https://acme.test", title: "Acme Tools" },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
}

describe("Context_Agent error paths", () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = mkdtempSync(join(tmpdir(), "context-agent-"));
    process.env.KB_STORAGE_PATH = storagePath;
    setLLMClient(new UnavailableLLMClient());
    eventBus.clear();
  });

  afterEach(() => {
    resetLLMClient();
    eventBus.clear();
    delete process.env.KB_STORAGE_PATH;
    rmSync(storagePath, { recursive: true, force: true });
  });

  // ---- Requirement 1.4: Firecrawl error ----

  test("a Firecrawl error presents exactly the retry and Q&A options", async () => {
    const agent = new ContextAgent({
      firecrawl: failingFirecrawl(),
      storagePath,
      entityId: "acme",
    });

    const result = await agent.ingest({ companyUrl: "https://acme.test" });

    expect(result.status).toBe("firecrawl_error");
    expect(result.recovery).toBeDefined();
    expect(result.recovery!.options).toEqual(["retry", "qa_pipeline"]);
    expect(result.recovery!.message).toContain("acme.test");
    expect(result.warnings?.[0]).toContain("Firecrawl could not ingest");
    // No draft was produced, so nothing is pending review.
    expect(result.draftId).toBeUndefined();
  });

  test("a Firecrawl error emits firecrawl.error with the url and reason", async () => {
    const seen: Array<{ url: string; reason: string }> = [];
    eventBus.subscribe("firecrawl.error", (payload) => {
      seen.push(payload);
    });

    const agent = new ContextAgent({
      firecrawl: failingFirecrawl(),
      storagePath,
      entityId: "acme",
    });
    await agent.ingest({ companyUrl: "https://acme.test" });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://acme.test");
    expect(seen[0].reason).toContain("502");
  });

  test("a Firecrawl error does not block other platform operations", async () => {
    const agent = new ContextAgent({
      firecrawl: failingFirecrawl(),
      storagePath,
      entityId: "acme",
    });

    const result = await agent.ingest({ companyUrl: "https://acme.test" });
    expect(result.status).toBe("firecrawl_error");

    // The recovery choice is deliberately left un-acted-upon here. Unrelated
    // operations must still complete rather than waiting on the user.
    const write = await writeKBEntity(
      {
        entityId: "unrelated-entity",
        entityType: "audience",
        content: "# Company_Identity\n\n_empty_\n\n# Products\n\n_empty_\n\n# Audiences\n\n_empty_\n\n# Experiments\n\n_empty_\n",
        emitEvent: false,
      },
      storagePath,
    );
    expect(write.version.versionNumber).toBe(1);

    // And a second ingestion attempt is accepted while the first is unresolved.
    const second = await agent.ingest({ freeTextEnrichment: "Mission: ship faster" });
    expect(second.status).toBe("success");
  });

  test("recovery.retry re-runs the scrape and can succeed", async () => {
    let attempt = 0;
    const flaky = new FirecrawlAdapter({
      baseUrl: "https://firecrawl.test",
      pollIntervalMs: 1,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/crawl")) {
          attempt += 1;
          // Fail the first attempt, succeed on the retry.
          if (attempt === 1) return new Response("nope", { status: 500 });
          return new Response(JSON.stringify({ id: "job-1" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            status: "completed",
            data: [
              {
                markdown: "# Acme\n\nOur mission is to help teams ship faster.\n",
                metadata: { sourceURL: "https://acme.test", title: "Acme" },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const agent = new ContextAgent({ firecrawl: flaky, storagePath, entityId: "acme" });
    const failed = await agent.ingest({ companyUrl: "https://acme.test" });
    expect(failed.status).toBe("firecrawl_error");

    const retried = await failed.recovery!.retry();
    expect(retried.status).toBe("success");
    expect(retried.draftId).toBeDefined();
    expect(retried.companySummary.name).toBe("Acme");
  });

  test("recovery.startQAPipeline hands back a fresh pipeline", async () => {
    const agent = new ContextAgent({
      firecrawl: failingFirecrawl(),
      storagePath,
      entityId: "acme",
    });
    const failed = await agent.ingest({ companyUrl: "https://acme.test" });

    const pipeline = failed.recovery!.startQAPipeline();
    expect(pipeline).toBeInstanceOf(QAPipeline);
    expect(pipeline.answeredCount()).toBe(0);
    expect(pipeline.currentQuestion()?.key).toBe("name");
  });

  // ---- Requirement 1.4: Q&A pipeline progression ----

  test("the Q&A pipeline is a 10-step chain covering the specified fields", () => {
    expect(QA_STEPS).toHaveLength(MAX_QA_PROMPTS);
    const keys = QA_STEPS.map((s) => s.key);
    // The seven fields the design names, in order.
    expect(keys.filter((k) =>
      ["name", "industry", "mission", "products", "brandVoice", "values", "targetOutcome"].includes(k),
    )).toEqual(["name", "industry", "mission", "products", "brandVoice", "values", "targetOutcome"]);
  });

  test("a 10-step progression produces a fully populated CompanyIdentity", () => {
    const pipeline = new QAPipeline({ entityId: "acme" });
    const answers: Record<string, string> = {
      name: "Acme Tools",
      industry: "Creative software",
      mission: "Help small studios ship faster",
      vision: "Every studio ships weekly",
      products: "Widget Pro, Widget Lite",
      brandVoice: "Direct, warm, practical",
      values: "Craft, candour, speed",
      features: "Templates, exports",
      benefits: "Save hours, look sharp",
      targetOutcome: "Grow trial signups, reduce churn",
    };

    let steps = 0;
    for (;;) {
      const question = pipeline.currentQuestion();
      if (!question) break;
      steps += 1;
      const result = pipeline.submitAnswer(answers[question.key] ?? "");
      expect(result.accepted).toBe(true);
      expect(question.step).toBe(steps);
      expect(question.totalSteps).toBe(10);
    }

    expect(steps).toBe(10);
    expect(pipeline.isComplete()).toBe(true);

    const identity = pipeline.build();
    expect(identity.id).toBe("acme");
    expect(identity.name).toBe("Acme Tools");
    expect(identity.industry).toBe("Creative software");
    expect(identity.mission).toBe("Help small studios ship faster");
    expect(identity.vision).toBe("Every studio ships weekly");
    expect(identity.brandVoice).toBe("Direct, warm, practical");
    expect(identity.values).toEqual(["Craft", "candour", "speed"]);
    expect(identity.features).toEqual(["Templates", "exports"]);
    expect(identity.benefits).toEqual(["Save hours", "look sharp"]);
    expect(identity.businessObjectives).toEqual([
      "Grow trial signups",
      "reduce churn",
    ]);
    expect(identity.products.map((p) => p.name)).toEqual([
      "Widget Pro",
      "Widget Lite",
    ]);
    expect(identity.products.every((p) => p.id.length > 0)).toBe(true);
    expect(identity.brandSignals?.tone).toBe("Direct, warm, practical");
  });

  test("a required question is re-asked when left blank", () => {
    const pipeline = new QAPipeline();
    const first = pipeline.currentQuestion()!;
    expect(first.key).toBe("name");
    expect(first.optional).toBe(false);

    const rejected = pipeline.submitAnswer("   ");
    expect(rejected.accepted).toBe(false);
    expect(rejected.error).toContain("name is required");
    // Still on the same question.
    expect(rejected.next?.key).toBe("name");
    expect(pipeline.answeredCount()).toBe(0);
  });

  test("optional questions may be skipped and are backfilled", () => {
    const pipeline = new QAPipeline();
    const required: Record<string, string> = {
      name: "Acme",
      industry: "SaaS",
      mission: "Ship faster",
      products: "Widget",
      brandVoice: "Direct",
      targetOutcome: "Grow signups",
    };

    for (;;) {
      const question = pipeline.currentQuestion();
      if (!question) break;
      // Answer only the required ones; skip every optional question.
      pipeline.submitAnswer(required[question.key] ?? "");
    }

    const identity = pipeline.build();
    expect(identity.vision).toBeUndefined();
    // Backfilled rather than left empty.
    expect(identity.values).toEqual(["customer focus"]);
    expect(identity.products).toHaveLength(1);
    expect(identity.mission).toBe("Ship faster");
  });

  test("completing the Q&A pipeline yields a reviewable draft", async () => {
    const agent = new ContextAgent({ storagePath, entityId: "acme" });
    const pipeline = agent.startQAPipeline();
    for (;;) {
      const question = pipeline.currentQuestion();
      if (!question) break;
      pipeline.submitAnswer(`answer for ${question.key}`);
    }

    const result = agent.completeQAPipeline(pipeline);
    expect(result.status).toBe("success");
    expect(result.draftId).toBeDefined();
    expect(result.kbVersion).toBe("");
    expect(agent.getDraft(result.draftId!)).not.toBeNull();
  });

  test("splitListAnswer handles commas, newlines and bullets", () => {
    expect(splitListAnswer("a, b, c")).toEqual(["a", "b", "c"]);
    expect(splitListAnswer("a\nb\nc")).toEqual(["a", "b", "c"]);
    expect(splitListAnswer("- one\n- two")).toEqual(["one", "two"]);
    expect(splitListAnswer("1. first\n2. second")).toEqual(["first", "second"]);
    expect(splitListAnswer("   ")).toEqual([]);
  });

  // ---- Requirement 1.7: rejection ----

  test("rejecting a draft leaves the KB byte-for-byte identical", async () => {
    const agent = new ContextAgent({
      firecrawl: workingFirecrawl(),
      storagePath,
      entityId: "acme",
    });

    // Seed the KB so there is real state to preserve.
    await agent.applyEdits({ name: "Existing Co", mission: "Existing mission" });
    const before = fingerprintTree(storagePath);
    expect(before.length).toBeGreaterThan(0);

    const ingested = await agent.ingest({ companyUrl: "https://acme.test" });
    expect(ingested.draftId).toBeDefined();
    // The scrape itself must not have written anything.
    expect(fingerprintTree(storagePath)).toBe(before);

    const rejection = agent.rejectDraft(ingested.draftId!);
    expect(rejection.discarded).toBe(true);
    expect(rejection.nextOptions).toEqual(["rescrape", "manual_context"]);

    // Requirement 1.7 — unchanged, byte for byte.
    expect(fingerprintTree(storagePath)).toBe(before);
    expect(agent.getDraft(ingested.draftId!)).toBeNull();
  });

  test("editing then rejecting a draft still writes nothing", async () => {
    const agent = new ContextAgent({
      firecrawl: workingFirecrawl(),
      storagePath,
      entityId: "acme",
    });
    await agent.applyEdits({ name: "Existing Co" });
    const before = fingerprintTree(storagePath);

    const ingested = await agent.ingest({ companyUrl: "https://acme.test" });
    agent.editDraft(ingested.draftId!, { mission: "An edited mission" });
    expect(agent.getDraft(ingested.draftId!)?.mission).toBe("An edited mission");

    agent.rejectDraft(ingested.draftId!);
    expect(fingerprintTree(storagePath)).toBe(before);
  });

  test("accepting a draft is what commits it, with a version id", async () => {
    const agent = new ContextAgent({
      firecrawl: workingFirecrawl(),
      storagePath,
      entityId: "acme",
    });

    const ingested = await agent.ingest({ companyUrl: "https://acme.test" });
    const before = fingerprintTree(storagePath);

    const accepted = await agent.acceptDraft(ingested.draftId!);
    expect(accepted.kbVersion).toBeTruthy();
    expect(fingerprintTree(storagePath)).not.toBe(before);

    const stored = await agent.readCurrent();
    expect(stored?.name).toBe("Acme Tools");
  });

  // ---- Requirements 1.2, 1.3, 1.6 ----

  test("user edits take precedence over scraped values", async () => {
    const agent = new ContextAgent({
      firecrawl: workingFirecrawl(),
      storagePath,
      entityId: "acme",
    });

    const result = await agent.ingest({
      companyUrl: "https://acme.test",
      userEdits: { name: "Operator Chosen Name", brandVoice: "playful" },
    });

    expect(result.companySummary.name).toBe("Operator Chosen Name");
    expect(result.companySummary.brandVoice).toBe("playful");
    // Non-conflicting scraped fields survive.
    expect(result.companySummary.mission).toContain("ship faster");
  });

  test("an edit versions the prior values of every modified field", async () => {
    const agent = new ContextAgent({ storagePath, entityId: "acme" });
    await agent.applyEdits({ name: "First Name", mission: "First mission" });

    const second = await agent.applyEdits({ mission: "Second mission" });
    expect(second.status).toBe("success");

    const { getVersionChain } = await import(
      "@/lib/content-creator-ai/kb/storage.js"
    );
    const chain = await getVersionChain("acme", storagePath);
    expect(chain.length).toBeGreaterThanOrEqual(2);

    const latest = chain[chain.length - 1];
    expect(latest.modifiedFields).toContain("mission");
    expect(latest.priorValues.mission).toBe("First mission");
    expect(latest.timestamp).toBeTruthy();
    expect(latest.author).toBe("user");
  });

  test("free-text enrichment merges Field: value lines", async () => {
    const agent = new ContextAgent({ storagePath, entityId: "acme" });
    await agent.applyEdits({ name: "Acme", mission: "Old mission" });

    const result = await agent.enrich(
      "Mission: A brand new mission\nValues: craft, candour",
    );

    expect(result.status).toBe("success");
    expect(result.companySummary.mission).toBe("A brand new mission");
    expect(result.companySummary.values).toEqual(["craft", "candour"]);
    // Non-conflicting fields preserved.
    expect(result.companySummary.name).toBe("Acme");
  });

  test("unparseable enrichment reports no_change rather than corrupting the KB", async () => {
    const agent = new ContextAgent({ storagePath, entityId: "acme" });
    await agent.applyEdits({ name: "Acme", mission: "Keep me" });
    const before = fingerprintTree(storagePath);

    const result = await agent.enrich("just some prose with no structure at all");

    expect(result.status).toBe("no_change");
    expect(result.warnings?.[0]).toContain("Could not extract");
    expect(fingerprintTree(storagePath)).toBe(before);
  });

  test("an empty input reports no_change", async () => {
    const agent = new ContextAgent({ storagePath, entityId: "acme" });
    const result = await agent.ingest({});
    expect(result.status).toBe("no_change");
  });

  // ---- Requirement 1.2: scrape limits surfaced ----

  test("hitting the page limit is reported as partial with a warning", async () => {
    const pages = Array.from({ length: 25 }, (_, i) => ({
      markdown: `# Page ${i}\n\nOur mission is to serve customers well.\n`,
      metadata: { sourceURL: `https://acme.test/${i}`, title: `Page ${i}` },
    }));

    const adapter = new FirecrawlAdapter({
      baseUrl: "https://firecrawl.test",
      pollIntervalMs: 1,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/crawl")) {
          return new Response(JSON.stringify({ id: "job-1" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ status: "scraping", data: pages }),
          { status: 200 },
        );
      },
    });

    const agent = new ContextAgent({
      firecrawl: adapter,
      storagePath,
      entityId: "acme",
    });
    const result = await agent.ingest({ companyUrl: "https://acme.test" });

    expect(result.status).toBe("partial");
    // Capped at 20 pages (Requirement 1.2).
    expect(result.scrapedPageCount).toBe(20);
    expect(result.warnings?.some((w) => w.includes("20-page limit"))).toBe(true);
  });

  test("exceeding the 60 second budget is reported as an error", async () => {
    const clock = { now: 0 };
    const adapter = new FirecrawlAdapter({
      baseUrl: "https://firecrawl.test",
      pollIntervalMs: 1,
      now: () => clock.now,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/crawl")) {
          return new Response(JSON.stringify({ id: "job-1" }), { status: 200 });
        }
        // Jump past the 60s deadline before any page is collected.
        clock.now += 61_000;
        return new Response(JSON.stringify({ status: "scraping", data: [] }), {
          status: 200,
        });
      },
    });

    const result = await adapter.scrapeCompany("https://acme.test");
    // No pages collected before the cut-off, so this is a failure not a partial.
    expect(result.status).toBe("error");
    expect(result.durationMs).toBeGreaterThanOrEqual(60_000);
  });

  test("the 60s budget keeps pages already collected as partial", async () => {
    const clock = { now: 0 };
    let poll = 0;
    const adapter = new FirecrawlAdapter({
      baseUrl: "https://firecrawl.test",
      pollIntervalMs: 1,
      now: () => clock.now,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/crawl")) {
          return new Response(JSON.stringify({ id: "job-1" }), { status: 200 });
        }
        poll += 1;
        if (poll === 1) {
          return new Response(
            JSON.stringify({
              status: "scraping",
              data: [
                {
                  markdown: "# Acme\n\nOur mission is to help teams ship.\n",
                  metadata: { sourceURL: "https://acme.test", title: "Acme" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        clock.now += 61_000;
        return new Response(JSON.stringify({ status: "scraping", data: [] }), {
          status: 200,
        });
      },
    });

    const result = await adapter.scrapeCompany("https://acme.test");
    expect(result.status).toBe("partial");
    expect(result.pageCount).toBe(1);
    expect(result.limitReached).toBe("time");
  });
});
