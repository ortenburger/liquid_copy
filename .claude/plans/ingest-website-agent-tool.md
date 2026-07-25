# Chat tool: ingest_website

## Goal
Expose Firecrawl company ingest as a chat agent tool so the model can scrape a URL into the markdown KB / RAG (same path as Knowledge page).

## Design (defaults)

| Field | Value |
|-------|--------|
| Tool name | `ingest_website` |
| Zod params | `{ url: z.string().url().describe("Website URL to scrape, e.g. https://example.com") }` |
| API | `api.ingestCompany(url)` — **reuse as-is** (no new backend) |
| Dep name | `ingestWebsite: (url: string) => Promise<unknown>` on `LiquidCopyToolDeps` |
| Success message | `Ingested · {name?} · KB {kbVersion?} ({pageCount?} pages)` — mirror Knowledge.tsx; on `firecrawl_error` return error string from `warnings[0]` |
| Demo / no API | Surface existing `ingestCompany` errors (real-data + API base URL required) |

### Reuse vs thinner path
**Reuse `ingestCompany`.** It already: syncConfig (Firecrawl key) → POST ingest → auto-accept draft → KB write. Feeds company_identity markdown used by RAG.

Thinner scrape→raw-markdown→`save_to_rag` = new backend surface; **out of scope** for this small feature.

### Not in scope
- New ingest API / Firecrawl adapter changes
- Per-URL entity ids / raw page dump
- Optional `entityId` / `maxPages` params
- Chat UI beyond optional tool-name hint

## Steps
1. Add `ingestWebsite` to `LiquidCopyToolDeps` + `ingest_website` tool in `web/src/lib/agent/tools.ts` — `frontend-dev`
2. Wire `ingestWebsite: (url) => this.ingestCompany(url)` in `agentChat` deps — `web/src/lib/api.ts` — `frontend-dev`
3. Add `case "ingest_website"` in `runAgentTool` (arg = URL string; call `ingestCompany`) — `web/src/lib/api.ts` — `frontend-dev`
4. Mention tool in ToolLoopAgent instructions — `web/src/lib/agent/run-agent.ts` — `frontend-dev`
5. Optional: add `ingest_website` to Chat placeholder hint — `web/src/pages/workspace/Chat.tsx` — `frontend-dev`

## Files Affected
- `web/src/lib/agent/tools.ts` — add dep + tool
- `web/src/lib/api.ts` — wire deps + runAgentTool case
- `web/src/lib/agent/run-agent.ts` — instructions
- `web/src/pages/workspace/Chat.tsx` — optional hint

## Security Considerations
- Requires user-configured `firecrawlApiKey` (existing Settings → syncConfig headers)
- URL validated via zod `.url()`; backend already rejects empty/placeholder URLs
- No new auth surface; same live API as Knowledge ingest
- Tool can overwrite/merge company_identity KB for that brand (same as Knowledge UI) — expected

## Tool execute sketch
```ts
ingest_website: tool({
  description:
    "Scrape a company website via Firecrawl and ingest into the knowledge base + RAG. Use when the user asks to ingest, scrape, or learn from a URL.",
  inputSchema: z.object({
    url: z.string().url().describe("Website URL to scrape, e.g. https://example.com"),
  }),
  execute: async ({ url }) => {
    const result = (await deps.ingestWebsite(url)) as {
      status?: string;
      warnings?: string[];
      companySummary?: { name?: string };
      kbVersion?: string;
      scrapedPageCount?: number;
    };
    if (result.status === "firecrawl_error") {
      return {
        ok: false,
        message: result.warnings?.[0] ?? `Firecrawl failed for ${url}`,
      };
    }
    return {
      ok: true,
      ...result,
      message: `Ingested${result.companySummary?.name ? ` · ${result.companySummary.name}` : ""}${result.kbVersion ? ` · KB ${result.kbVersion}` : ""}${typeof result.scrapedPageCount === "number" ? ` · ${result.scrapedPageCount} pages` : ""}`,
    };
  },
}),
```

## Unresolved Questions
- None blocking. If later need raw page markdown under a custom `entityId`, add a separate thinner tool — do not overload this one.
