/**
 * Context_Agent — Firecrawl ingestion, Q&A fallback, KB population (Task 5.3).
 *
 * Requirements 1.1–1.7.
 *
 * Draft-then-commit: a scrape produces a draft held in memory and presented for
 * review (1.5); the KB is written only on accept or edit. This is what lets
 * rejection leave the KB byte-for-byte unchanged (1.7 / Property 4) — writing on
 * scrape and rolling back later could not offer that guarantee.
 *
 * Free-text enrichment (1.3) and explicit field edits (1.6) are already the
 * user's own input, so they merge into the KB and version immediately; there is
 * nothing to review and nothing to reject.
 */
import { randomUUID } from "node:crypto";
import type {
  CompanyIdentity,
  ContextAgentInput,
  ContextAgentOutput,
  KBPayload,
} from "../../types/index.js";
import { readKBEntity, writeKBEntity } from "../../kb/storage.js";
import { parseFromMarkdown } from "../../kb/markdown.js";
import { deepMergeUserPrecedence } from "../../kb/merge.js";
import {
  FirecrawlAdapter,
  type FirecrawlScrapeResult,
} from "../../integrations/firecrawl.js";
import {
  getLLMClient,
  parseJSONFromLLM,
  type LLMClient,
} from "../../integrations/llm.js";
import { buildCompanySummary, slugify } from "./summary.js";
import { QAPipeline } from "./qa-pipeline.js";

/** Recovery affordances offered when Firecrawl fails (Requirement 1.4). */
export interface ContextRecovery {
  message: string;
  options: readonly ["retry", "qa_pipeline"];
  /** Re-run the same scrape. */
  retry(): Promise<ContextIngestResult>;
  /** Begin the guided manual pipeline instead. */
  startQAPipeline(): QAPipeline;
}

/**
 * `ContextAgentOutput` plus the extra affordances this agent needs. The base
 * interface is Agent 1's stable shared contract, so it is extended, not changed.
 */
export interface ContextIngestResult extends ContextAgentOutput {
  /** Identifies the pending draft for accept/edit/reject. Absent once persisted. */
  draftId?: string;
  /** Present only when `status === "firecrawl_error"`. */
  recovery?: ContextRecovery;
}

export interface ContextAgentOptions {
  firecrawl?: FirecrawlAdapter;
  llm?: LLMClient;
  /** Overrides `KB_STORAGE_PATH`. */
  storagePath?: string;
  /** KB entity id for the company record. Defaults to a slug of the name. */
  entityId?: string;
}

interface Draft {
  id: string;
  summary: CompanyIdentity;
  scrapedPageCount: number;
  durationMs: number;
  warnings: string[];
  sourceUrl?: string;
}

/** Fields the agent knows how to read out of free-text enrichment. */
const ENRICHMENT_SCALARS = [
  "name",
  "industry",
  "mission",
  "vision",
  "brandVoice",
  "pricing",
] as const;
const ENRICHMENT_LISTS = [
  "values",
  "features",
  "benefits",
  "businessObjectives",
] as const;

export class ContextAgent {
  private readonly firecrawl: FirecrawlAdapter;
  private readonly llm: LLMClient;
  private readonly storagePath?: string;
  private readonly entityIdOverride?: string;
  private readonly drafts = new Map<string, Draft>();

  constructor(options: ContextAgentOptions = {}) {
    this.firecrawl = options.firecrawl ?? new FirecrawlAdapter();
    this.llm = options.llm ?? getLLMClient();
    this.storagePath = options.storagePath;
    this.entityIdOverride = options.entityId;
  }

  /**
   * Entry point. Dispatches on which field of `ContextAgentInput` is present:
   * `companyUrl` scrapes, `freeTextEnrichment` merges, `userEdits` edits.
   */
  async ingest(input: ContextAgentInput): Promise<ContextIngestResult> {
    if (input.companyUrl) return this.ingestFromUrl(input.companyUrl, input.userEdits);
    if (input.freeTextEnrichment) return this.enrich(input.freeTextEnrichment);
    if (input.userEdits) return this.applyEdits(input.userEdits);
    return {
      companySummary: await this.currentSummaryOrEmpty(),
      kbVersion: "",
      scrapedPageCount: 0,
      durationMs: 0,
      status: "no_change",
      warnings: ["No companyUrl, freeTextEnrichment or userEdits supplied"],
    };
  }

  // ---- Scrape path (1.1, 1.2, 1.4, 1.5) ----

  private async ingestFromUrl(
    companyUrl: string,
    userEdits?: Partial<CompanyIdentity>,
  ): Promise<ContextIngestResult> {
    const scrape = await this.firecrawl.scrapeCompany(companyUrl);

    if (scrape.status === "error") {
      // Return immediately with a choice; never await the user (1.4).
      return {
        companySummary: await this.currentSummaryOrEmpty(),
        kbVersion: "",
        scrapedPageCount: 0,
        durationMs: scrape.durationMs,
        status: "firecrawl_error",
        warnings: [
          `Firecrawl could not ingest ${companyUrl}: ${scrape.error?.reason ?? "unknown error"}`,
        ],
        recovery: this.buildRecovery(companyUrl, scrape, userEdits),
      };
    }

    return this.draftFromScrape(companyUrl, scrape, userEdits);
  }

  private buildRecovery(
    companyUrl: string,
    scrape: FirecrawlScrapeResult,
    userEdits?: Partial<CompanyIdentity>,
  ): ContextRecovery {
    return {
      message:
        `Could not scrape ${companyUrl} (${scrape.error?.reason ?? "unknown error"}). ` +
        `Retry the request, or answer a short set of questions instead.`,
      options: ["retry", "qa_pipeline"] as const,
      retry: () => this.ingestFromUrl(companyUrl, userEdits),
      startQAPipeline: () =>
        new QAPipeline({ llm: this.llm, entityId: this.entityIdOverride }),
    };
  }

  private async draftFromScrape(
    companyUrl: string,
    scrape: FirecrawlScrapeResult,
    userEdits?: Partial<CompanyIdentity>,
  ): Promise<ContextIngestResult> {
    const { summary, warnings } = await buildCompanySummary({
      pages: scrape.pages,
      sourceUrl: companyUrl,
      entityId: this.entityIdOverride,
      llm: this.llm,
    });

    // User-provided values outrank anything scraped (1.2).
    const merged = userEdits
      ? deepMergeUserPrecedence(
          summary as unknown as Record<string, unknown>,
          userEdits as Record<string, unknown>,
        ) as unknown as CompanyIdentity
      : summary;

    const allWarnings = [...warnings];
    if (scrape.limitReached === "pages") {
      allWarnings.push(`Scrape stopped at the ${scrape.pageCount}-page limit`);
    } else if (scrape.limitReached === "time") {
      allWarnings.push(
        `Scrape stopped at the 60s limit after ${scrape.pageCount} page(s)`,
      );
    }

    const draft: Draft = {
      id: randomUUID(),
      summary: merged,
      scrapedPageCount: scrape.pageCount,
      durationMs: scrape.durationMs,
      warnings: allWarnings,
      sourceUrl: companyUrl,
    };
    this.drafts.set(draft.id, draft);

    return {
      companySummary: merged,
      // Not yet persisted — the KB version arrives on accept/edit.
      kbVersion: "",
      scrapedPageCount: scrape.pageCount,
      durationMs: scrape.durationMs,
      status: scrape.status === "partial" ? "partial" : "success",
      warnings: allWarnings,
      draftId: draft.id,
    };
  }

  // ---- Q&A path (1.4) ----

  /** Start the guided pipeline directly, without a failed scrape first. */
  startQAPipeline(): QAPipeline {
    return new QAPipeline({ llm: this.llm, entityId: this.entityIdOverride });
  }

  /**
   * Turn a completed Q&A pipeline into a reviewable draft, matching the scrape
   * path so the operator sees the same review step either way.
   */
  completeQAPipeline(pipeline: QAPipeline): ContextIngestResult {
    const summary = pipeline.build();
    const warnings = pipeline.isComplete()
      ? []
      : ["Q&A pipeline was incomplete; unanswered fields were derived"];
    const draft: Draft = {
      id: randomUUID(),
      summary,
      scrapedPageCount: 0,
      durationMs: 0,
      warnings,
    };
    this.drafts.set(draft.id, draft);
    return {
      companySummary: summary,
      kbVersion: "",
      scrapedPageCount: 0,
      durationMs: 0,
      status: "success",
      warnings,
      draftId: draft.id,
    };
  }

  // ---- Draft review (1.5, 1.6, 1.7) ----

  getDraft(draftId: string): CompanyIdentity | null {
    return this.drafts.get(draftId)?.summary ?? null;
  }

  /** Commit a reviewed draft to the KB, versioning any prior state. */
  async acceptDraft(
    draftId: string,
    author: "system" | "user" = "user",
  ): Promise<ContextIngestResult> {
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error(`Unknown draft: ${draftId}`);
    this.drafts.delete(draftId);
    const written = await this.persist(draft.summary, author);
    return {
      companySummary: draft.summary,
      kbVersion: written.kbVersion,
      scrapedPageCount: draft.scrapedPageCount,
      durationMs: draft.durationMs,
      status: "success",
      warnings: draft.warnings,
    };
  }

  /**
   * Apply inline edits to a pending draft before it is committed. The edited
   * draft stays pending, so rejection after an edit still writes nothing.
   */
  editDraft(
    draftId: string,
    edits: Partial<CompanyIdentity>,
  ): CompanyIdentity {
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error(`Unknown draft: ${draftId}`);
    draft.summary = deepMergeUserPrecedence(
      draft.summary as unknown as Record<string, unknown>,
      edits as Record<string, unknown>,
    ) as unknown as CompanyIdentity;
    return draft.summary;
  }

  /**
   * Discard a draft. Performs no storage access at all, so the KB is left
   * byte-for-byte identical (1.7 / Property 4).
   */
  rejectDraft(draftId: string): {
    discarded: boolean;
    nextOptions: readonly ["rescrape", "manual_context"];
  } {
    const discarded = this.drafts.delete(draftId);
    return { discarded, nextOptions: ["rescrape", "manual_context"] as const };
  }

  // ---- Enrichment and edit paths (1.3, 1.6) ----

  /** Merge free-text enrichment into the stored KB entry, user values winning. */
  async enrich(freeText: string): Promise<ContextIngestResult> {
    const extracted = await this.extractEnrichment(freeText);
    if (Object.keys(extracted).length === 0) {
      return {
        companySummary: await this.currentSummaryOrEmpty(),
        kbVersion: "",
        scrapedPageCount: 0,
        durationMs: 0,
        status: "no_change",
        warnings: [
          "Could not extract any structured fields from the enrichment text",
        ],
      };
    }
    return this.applyEdits(extracted);
  }

  /**
   * Merge user values over the stored entry and write a new version capturing
   * the prior values of every modified field plus a timestamp (1.6).
   */
  async applyEdits(
    edits: Partial<CompanyIdentity>,
  ): Promise<ContextIngestResult> {
    const existing = await this.readCurrent();
    const base: CompanyIdentity = existing ?? emptyIdentity(
      this.entityIdOverride ?? slugify(edits.name ?? "company"),
    );

    const merged = deepMergeUserPrecedence(
      base as unknown as Record<string, unknown>,
      edits as Record<string, unknown>,
    ) as unknown as CompanyIdentity;

    const { modifiedFields, priorValues } = diffFields(base, merged);
    if (existing && modifiedFields.length === 0) {
      return {
        companySummary: merged,
        kbVersion: existing.kbVersion ?? "",
        scrapedPageCount: 0,
        durationMs: 0,
        status: "no_change",
        warnings: ["Edits matched the stored values; no new version written"],
      };
    }

    const written = await this.persist(merged, "user", {
      modifiedFields,
      priorValues,
    });
    return {
      companySummary: merged,
      kbVersion: written.kbVersion,
      scrapedPageCount: 0,
      durationMs: 0,
      status: "success",
      warnings: [],
    };
  }

  /**
   * Pull structured fields out of free text. Deterministic `Field: value` lines
   * are read first; the LLM handles prose when available.
   */
  private async extractEnrichment(
    freeText: string,
  ): Promise<Partial<CompanyIdentity>> {
    const out: Partial<CompanyIdentity> = {};
    const assignScalar = (key: string, value: string): void => {
      const match = ENRICHMENT_SCALARS.find(
        (k) => k.toLowerCase() === key.toLowerCase().replace(/[\s_]/g, ""),
      );
      if (match && value.trim()) {
        (out as Record<string, unknown>)[match] = value.trim();
      }
    };
    const assignList = (key: string, value: string): void => {
      const match = ENRICHMENT_LISTS.find(
        (k) => k.toLowerCase() === key.toLowerCase().replace(/[\s_]/g, ""),
      );
      if (!match) return;
      const items = value
        .split(/[\n;,]/)
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      if (items.length > 0) (out as Record<string, unknown>)[match] = items;
    };

    for (const line of freeText.split(/\r?\n/)) {
      const kv = line.match(/^\s*([A-Za-z][A-Za-z _]*?)\s*:\s*(.+)$/);
      if (!kv) continue;
      assignScalar(kv[1], kv[2]);
      assignList(kv[1], kv[2]);
    }

    if (Object.keys(out).length > 0) return out;

    const raw = await this.llm.complete(
      `Extract company profile fields from the note below.\n` +
        `Reply with JSON only using any of these keys: ${[...ENRICHMENT_SCALARS, ...ENRICHMENT_LISTS].join(", ")}.\n` +
        `Omit keys the note does not mention. Do not invent facts.\n\n${freeText.slice(0, 4000)}`,
      { temperature: 0 },
    );
    const parsed = parseJSONFromLLM<Record<string, unknown>>(raw);
    if (!parsed) return out;

    for (const key of ENRICHMENT_SCALARS) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        (out as Record<string, unknown>)[key] = value.trim();
      }
    }
    for (const key of ENRICHMENT_LISTS) {
      const value = parsed[key];
      if (Array.isArray(value)) {
        const items = value
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0);
        if (items.length > 0) (out as Record<string, unknown>)[key] = items;
      }
    }
    return out;
  }

  // ---- KB access ----

  private entityIdFor(summary: CompanyIdentity): string {
    return this.entityIdOverride ?? summary.id ?? slugify(summary.name);
  }

  /** Read and parse the stored company identity, or null if absent. */
  async readCurrent(): Promise<CompanyIdentity | null> {
    const entityId = this.entityIdOverride;
    if (!entityId) return null;
    const markdown = await readKBEntity(entityId, this.storagePath);
    if (!markdown) return null;
    const parsed = parseFromMarkdown(markdown);
    return parsed.payload.companyIdentity ?? null;
  }

  private async currentSummaryOrEmpty(): Promise<CompanyIdentity> {
    return (
      (await this.readCurrent()) ??
      emptyIdentity(this.entityIdOverride ?? "company")
    );
  }

  private async persist(
    summary: CompanyIdentity,
    author: "system" | "user",
    version?: { modifiedFields: string[]; priorValues: Record<string, unknown> },
  ): Promise<{ kbVersion: string }> {
    const entityId = this.entityIdFor(summary);
    const payload: KBPayload = {
      companyIdentity: { ...summary, id: entityId },
      products: summary.products,
      audiences: [],
      experiments: [],
    };
    const result = await writeKBEntity(
      {
        entityId,
        entityType: "company_identity",
        content: payload,
        author,
        modifiedFields: version?.modifiedFields,
        priorValues: version?.priorValues,
      },
      this.storagePath,
    );
    return { kbVersion: result.version.versionId };
  }
}

/** Fields compared when deciding whether an edit changed anything. */
const DIFFABLE_FIELDS: Array<keyof CompanyIdentity> = [
  "name", "industry", "mission", "vision", "brandVoice", "pricing",
  "values", "features", "benefits", "businessObjectives", "products",
];

/**
 * Which fields an edit changed, and what they held before. Feeds the KB version
 * record so history captures prior values (Requirement 1.6 / Property 3).
 */
export function diffFields(
  before: CompanyIdentity,
  after: CompanyIdentity,
): { modifiedFields: string[]; priorValues: Record<string, unknown> } {
  const modifiedFields: string[] = [];
  const priorValues: Record<string, unknown> = {};
  for (const field of DIFFABLE_FIELDS) {
    const a = before[field];
    const b = after[field];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    modifiedFields.push(field);
    priorValues[field] = a ?? null;
  }
  return { modifiedFields, priorValues };
}

function emptyIdentity(id: string): CompanyIdentity {
  return {
    id,
    name: "",
    mission: "",
    brandVoice: "",
    values: [],
    products: [],
    features: [],
    benefits: [],
  };
}
