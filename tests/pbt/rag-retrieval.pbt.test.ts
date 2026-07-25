// Feature: content-creator-ai, Property 7: RAG returns at most k results, all from indexed content
// Feature: content-creator-ai, Property 29: RAG passage count is always min(available, 5)
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import type { KBDocument, RAGPassage } from "@/lib/content-creator-ai/types/index.js";
import type { RetrievalScope } from "@/lib/content-creator-ai/types/enums.js";
import {
  InMemoryVectorStore,
  resetVectorStore,
  indexDocuments,
  semanticSearch,
  selectPassagesForPrompt,
} from "@/lib/content-creator-ai/rag/vectorstore.js";

const scopes: RetrievalScope[] = [
  "product_context",
  "company_memory",
  "experiment_history",
  "audience_learning",
];

const contentArb = fc
  .string({ minLength: 8, maxLength: 80 })
  .filter((s) => s.trim().length >= 8);

const docArb: fc.Arbitrary<KBDocument> = fc.record({
  id: fc.uuid(),
  entityId: fc.uuid(),
  entityType: fc.constantFrom(
    "company_identity" as const,
    "product" as const,
    "audience" as const,
    "experiment" as const,
  ),
  scope: fc.constantFrom(...scopes),
  content: contentArb,
  metadata: fc.constant({}),
});

describe("RAG retrieval property tests", () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    process.env.RAG_FORCE_LOCAL_EMBED = "1";
    store = resetVectorStore();
  });

  afterEach(async () => {
    await store.clear();
    delete process.env.RAG_FORCE_LOCAL_EMBED;
  });

  // Feature: content-creator-ai, Property 7: RAG returns at most k results, all from indexed content
  test("Property 7: RAG returns at most k results, all from indexed content", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(docArb, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 1, max: 10 }),
        contentArb,
        fc.option(fc.constantFrom(...scopes), { nil: undefined }),
        async (docs, k, query, scope) => {
          // Deduplicate by id so index size is predictable
          const unique = new Map<string, KBDocument>();
          for (const d of docs) unique.set(d.id, d);
          const indexed = [...unique.values()];

          await store.clear();
          await indexDocuments(indexed);

          const results = await semanticSearch({ query, k, scope });
          const scopedCount = scope
            ? indexed.filter((d) => d.scope === scope).length
            : indexed.length;

          if (results.length > Math.min(scopedCount, k)) return false;
          if (results.length > k) return false;

          const contents = store.getIndexedContents();
          for (const passage of results) {
            const found = contents.some(
              (c) => c.includes(passage.content) || passage.content.includes(c) || c === passage.content,
            );
            if (!found) return false;
            // Passage content must equal an indexed document content (exact for our store)
            if (!contents.includes(passage.content)) return false;
            if (scope && passage.scope !== scope) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: content-creator-ai, Property 29: RAG passage count is always min(available, 5)
  test("Property 29: RAG passage count is always min(available, 5)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            content: contentArb,
            sourceDoc: fc.uuid(),
            similarityScore: fc.float({ min: 0, max: 1, noNaN: true }),
            scope: fc.constantFrom(...scopes),
          }),
          { minLength: 0, maxLength: 20 },
        ),
        (passages: RAGPassage[]) => {
          const { passages: selected, generatedWithoutRetrievedContext } =
            selectPassagesForPrompt(passages);
          const expected = Math.min(passages.length, 5);
          if (selected.length !== expected) return false;
          if (passages.length === 0) {
            return generatedWithoutRetrievedContext === true;
          }
          return generatedWithoutRetrievedContext === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("semanticSearch returns [] when store unavailable", async () => {
    store.markUnavailable();
    await indexDocuments([
      {
        id: "a",
        entityId: "e",
        entityType: "company_identity",
        scope: "company_memory",
        content: "hello world company mission",
      },
    ]);
    const results = await semanticSearch({ query: "mission", k: 5 });
    expect(results).toEqual([]);
  });

  test("semanticSearch returns [] for empty index", async () => {
    const results = await semanticSearch({ query: "anything", k: 5 });
    expect(results).toEqual([]);
  });
});
