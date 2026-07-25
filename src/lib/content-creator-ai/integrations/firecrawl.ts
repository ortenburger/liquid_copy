/**
 * FirecrawlAdapter — company/product context ingestion (Task 5.1).
 *
 * Requirements 1.1, 1.4:
 * - Scrape a company site, capped at 20 pages OR 60 seconds, whichever first.
 * - On error, emit `firecrawl.error` and return a typed error result. The
 *   adapter NEVER throws and NEVER awaits user input, so a failed scrape cannot
 *   block any other platform operation.
 */
import { eventBus } from "../orchestration/event-bus.js";

export const MAX_PAGES = 20;
export const MAX_DURATION_MS = 60_000;

export interface FirecrawlPage {
  url: string;
  title?: string;
  markdown: string;
}

/** Why scraping stopped short of a complete crawl. */
export type FirecrawlLimit = "pages" | "time";

export interface FirecrawlScrapeResult {
  status: "success" | "partial" | "error";
  pages: FirecrawlPage[];
  pageCount: number;
  durationMs: number;
  /** Set when a cap truncated the crawl. */
  limitReached?: FirecrawlLimit;
  error?: { url: string; reason: string };
}

export interface FirecrawlAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxPages?: number;
  maxDurationMs?: number;
  /** Poll interval while a crawl job is running. Default 500ms. */
  pollIntervalMs?: number;
  /** Injected clock, for deterministic limit tests. */
  now?: () => number;
}

interface CrawlStartResponse {
  id?: string;
  url?: string;
  success?: boolean;
  error?: string;
}

interface CrawlStatusResponse {
  status?: "scraping" | "completed" | "failed" | "cancelled";
  data?: Array<{
    markdown?: string;
    metadata?: { sourceURL?: string; url?: string; title?: string };
  }>;
  error?: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as unknown as { unref?: () => void }).unref?.();
  });

function normalisePages(data: CrawlStatusResponse["data"]): FirecrawlPage[] {
  if (!Array.isArray(data)) return [];
  const pages: FirecrawlPage[] = [];
  for (const item of data) {
    const markdown = typeof item?.markdown === "string" ? item.markdown : "";
    const url = item?.metadata?.sourceURL ?? item?.metadata?.url ?? "";
    if (!markdown && !url) continue;
    pages.push({ url, title: item?.metadata?.title, markdown });
  }
  return pages;
}

export class FirecrawlAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxPages: number;
  private readonly maxDurationMs: number;
  private readonly pollIntervalMs: number;
  private readonly now: () => number;

  constructor(options: FirecrawlAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.FIRECRAWL_API_KEY ?? "";
    this.baseUrl = (
      options.baseUrl ??
      process.env.FIRECRAWL_BASE_URL ??
      "https://api.firecrawl.dev"
    ).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxPages = options.maxPages ?? MAX_PAGES;
    this.maxDurationMs = options.maxDurationMs ?? MAX_DURATION_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Crawl `url`, stopping at the page or time cap. Always resolves; failures
   * arrive as `status: "error"` alongside a `firecrawl.error` event.
   */
  async scrapeCompany(url: string): Promise<FirecrawlScrapeResult> {
    const startedAt = this.now();
    const elapsed = (): number => this.now() - startedAt;

    // A single AbortController bounds the whole crawl, not each request, so the
    // 60s cap covers start + every poll rather than resetting per call.
    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(),
      this.maxDurationMs,
    );
    (deadline as unknown as { unref?: () => void }).unref?.();

    try {
      const started = await this.startCrawl(url, controller.signal);
      if (!started.ok) {
        return this.fail(url, started.reason, elapsed());
      }

      const collected = new Map<string, FirecrawlPage>();
      let limitReached: FirecrawlLimit | undefined;
      let terminal = false;

      // Poll until the job finishes or a cap trips.
      for (;;) {
        if (elapsed() >= this.maxDurationMs) {
          limitReached = "time";
          break;
        }

        const status = await this.pollCrawl(started.id, controller.signal);
        if (!status.ok) {
          // Losing the poll after pages are already in hand is a partial
          // success, not a total failure — keep what we have.
          if (collected.size > 0) break;
          return this.fail(url, status.reason, elapsed());
        }

        for (const page of normalisePages(status.body.data)) {
          const key = page.url || `page-${collected.size}`;
          if (!collected.has(key)) collected.set(key, page);
          if (collected.size >= this.maxPages) break;
        }

        if (collected.size >= this.maxPages) {
          limitReached = "pages";
          break;
        }
        if (status.body.status === "completed") {
          terminal = true;
          break;
        }
        if (status.body.status === "failed" || status.body.status === "cancelled") {
          if (collected.size > 0) break;
          return this.fail(
            url,
            status.body.error ?? `crawl ${status.body.status}`,
            elapsed(),
          );
        }

        await sleep(this.pollIntervalMs);
      }

      const pages = [...collected.values()].slice(0, this.maxPages);

      if (pages.length === 0) {
        // A crawl that yielded nothing is a failure, not a partial success.
        // The design's error table maps "hit the 60s limit" to partial, but that
        // presumes some pages arrived: Requirement 1.2 only applies "WHEN
        // Firecrawl returns scraped content". With zero pages there is nothing to
        // review, so the operator is better served by Requirement 1.4's
        // retry-or-Q&A recovery than by a placeholder summary.
        return this.fail(
          url,
          limitReached === "time"
            ? `scrape reached the ${this.maxDurationMs}ms limit before returning any page`
            : "Firecrawl returned no pages",
          elapsed(),
        );
      }

      return {
        // A truncated crawl is reported as partial so the summary can surface it.
        status: limitReached || !terminal ? "partial" : "success",
        pages,
        pageCount: pages.length,
        durationMs: elapsed(),
        limitReached,
      };
    } catch (err) {
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      return this.fail(
        url,
        aborted
          ? `scrape exceeded ${this.maxDurationMs}ms limit`
          : err instanceof Error
            ? err.message
            : String(err),
        elapsed(),
      );
    } finally {
      clearTimeout(deadline);
    }
  }

  private async fail(
    url: string,
    reason: string,
    durationMs: number,
  ): Promise<FirecrawlScrapeResult> {
    // Fire-and-forget by contract: awaiting subscriber acknowledgement here
    // would let a slow listener block ingestion (Requirement 1.4).
    await eventBus.publish("firecrawl.error", { url, reason });
    return {
      status: "error",
      pages: [],
      pageCount: 0,
      durationMs,
      error: { url, reason },
    };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  private async startCrawl(
    url: string,
    signal: AbortSignal,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/crawl`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        url,
        limit: this.maxPages,
        scrapeOptions: { formats: ["markdown"] },
      }),
      signal,
    });

    if (!res.ok) {
      return {
        ok: false,
        reason: `Firecrawl responded ${res.status} ${res.statusText}`.trim(),
      };
    }

    const body = (await res.json()) as CrawlStartResponse;
    if (body.success === false || body.error) {
      return { ok: false, reason: body.error ?? "Firecrawl rejected the crawl" };
    }
    const id = body.id ?? body.url?.split("/").pop();
    if (!id) return { ok: false, reason: "Firecrawl returned no crawl id" };
    return { ok: true, id };
  }

  private async pollCrawl(
    id: string,
    signal: AbortSignal,
  ): Promise<
    { ok: true; body: CrawlStatusResponse } | { ok: false; reason: string }
  > {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/crawl/${id}`, {
      method: "GET",
      headers: this.headers(),
      signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: `Firecrawl status check responded ${res.status}`,
      };
    }
    return { ok: true, body: (await res.json()) as CrawlStatusResponse };
  }
}
