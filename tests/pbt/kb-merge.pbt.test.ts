// Feature: content-creator-ai, Property 1: User-provided values always take precedence in KB merge
// Feature: content-creator-ai, Property 2: Company summary always contains required structural fields
// Feature: content-creator-ai, Property 3: KB edit always creates a version record with prior values
// Feature: content-creator-ai, Property 4: Rejection never mutates the KB
// Feature: content-creator-ai, Property 5: KB Markdown serialisation preserves required sections
// Feature: content-creator-ai, Property 6: Version history is append-only and monotonically ordered
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { deepMergeUserPrecedence } from "@/lib/content-creator-ai/kb/merge.js";
import {
  serialiseToMarkdown,
  parseFromMarkdown,
  validateMarkdownSections,
  REQUIRED_SECTIONS,
} from "@/lib/content-creator-ai/kb/markdown.js";
import {
  writeKBEntity,
  readKBEntity,
  getVersionChain,
  discardDraftWithoutMutation,
  entityStorageFingerprint,
  assertSnapshotImmutable,
  SnapshotImmutableError,
  resolveKBStoragePath,
} from "@/lib/content-creator-ai/kb/storage.js";
import { eventBus } from "@/lib/content-creator-ai/orchestration/event-bus.js";
import { buildCompanySummary } from "@/lib/content-creator-ai/agents/context-agent/summary.js";
import type {
  AudiencePersona,
  CompanyIdentity,
  Experiment,
  Product,
} from "@/lib/content-creator-ai/types/index.js";

const stringField = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter(
    (s) =>
      s.trim().length > 0 &&
      s === s.trim() &&
      !s.includes("\n") &&
      !s.includes("#") &&
      s !== "__proto__" &&
      s !== "constructor" &&
      s !== "prototype",
  );

const dictValue = fc.oneof(stringField, fc.integer());
const safeDict = fc.dictionary(stringField, dictValue, {
  minKeys: 1,
  maxKeys: 8,
});


const companyArb: fc.Arbitrary<CompanyIdentity> = fc.record({
  id: stringField,
  name: stringField,
  mission: stringField,
  brandVoice: stringField,
  values: fc.array(stringField, { minLength: 0, maxLength: 3 }),
  features: fc.array(stringField, { minLength: 0, maxLength: 3 }),
  benefits: fc.array(stringField, { minLength: 0, maxLength: 3 }),
  products: fc.constant([] as Product[]),
  industry: fc.option(stringField, { nil: undefined }),
  vision: fc.option(stringField, { nil: undefined }),
  pricing: fc.option(stringField, { nil: undefined }),
  businessObjectives: fc.array(stringField, { minLength: 0, maxLength: 2 }),
});

const productArb: fc.Arbitrary<Product> = fc.record({
  id: stringField,
  name: stringField,
  features: fc.array(stringField, { minLength: 0, maxLength: 3 }),
  benefits: fc.array(stringField, { minLength: 0, maxLength: 3 }),
  pricing: fc.option(stringField, { nil: undefined }),
  targetAudience: fc.option(stringField, { nil: undefined }),
});

const personaArb: fc.Arbitrary<AudiencePersona> = fc.record({
  id: stringField,
  icpDefinition: stringField,
  painPoints: fc.array(stringField, { minLength: 1, maxLength: 3 }),
  jobsToBeDone: fc.array(stringField, { minLength: 0, maxLength: 2 }),
  objections: fc.array(stringField, { minLength: 0, maxLength: 2 }),
  dreamOutcomes: fc.array(stringField, { minLength: 0, maxLength: 2 }),
  source: fc.constantFrom(
    "ai_generated" as const,
    "user_created" as const,
    "merged" as const,
  ),
  kbVersion: stringField,
  createdAt: fc.constant("2026-01-01T00:00:00.000Z"),
});

const experimentArb: fc.Arbitrary<Experiment> = fc.record({
  id: stringField,
  hypothesisId: stringField,
  postVariantIds: fc.array(stringField, { minLength: 0, maxLength: 3 }),
  publishedDates: fc.array(stringField, { minLength: 0, maxLength: 2 }),
  lessonsLearned: fc.option(stringField, { nil: undefined }),
  status: fc.constantFrom(
    "draft" as const,
    "running" as const,
    "completed" as const,
    "inconclusive" as const,
  ),
  versionCounter: fc.nat({ max: 20 }),
  createdAt: fc.constant("2026-01-01T00:00:00.000Z"),
});

describe("KB merge & storage property tests", () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = mkdtempSync(join(tmpdir(), "kb-pbt-"));
    eventBus.clear();
    process.env.KB_STORAGE_PATH = storagePath;
  });

  afterEach(() => {
    eventBus.clear();
    delete process.env.KB_STORAGE_PATH;
    rmSync(storagePath, { recursive: true, force: true });
  });

  // Feature: content-creator-ai, Property 1: User-provided values always take precedence in KB merge
  test("Property 1: user-provided values always take precedence in KB merge", () => {
    fc.assert(
      fc.property(safeDict, safeDict, (existing, userProvided) => {
        const merged = deepMergeUserPrecedence(existing, userProvided);
        for (const key of Object.keys(userProvided)) {
          if (userProvided[key] === undefined) continue;
          if (merged[key] !== userProvided[key]) return false;
        }
        for (const key of Object.keys(existing)) {
          if (!(key in userProvided) || userProvided[key] === undefined) {
            if (merged[key] !== existing[key]) return false;
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  // Feature: content-creator-ai, Property 3: KB edit always creates a version record with prior values
  test("Property 3: KB edit always creates a version record with prior values", async () => {
    await fc.assert(
      fc.asyncProperty(
        companyArb,
        companyArb,
        async (first, second) => {
          // Unique id per iteration — shared storage across fc runs must not collide
          const entityId = `e-${randomUUID()}`;
          const prior = {
            companyIdentity: { ...first, id: entityId },
            products: [] as Product[],
            audiences: [] as AudiencePersona[],
            experiments: [] as Experiment[],
          };
          await writeKBEntity({
            entityId,
            entityType: "company_identity",
            content: prior,
            emitEvent: false,
          }, storagePath);

          const next = {
            companyIdentity: { ...second, id: entityId },
            products: [] as Product[],
            audiences: [] as AudiencePersona[],
            experiments: [] as Experiment[],
          };
          const { version } = await writeKBEntity({
            entityId,
            entityType: "company_identity",
            content: next,
            priorValues: { name: first.name, mission: first.mission },
            modifiedFields: ["name", "mission"],
            emitEvent: false,
          }, storagePath);

          const chain = await getVersionChain(entityId, storagePath);
          expect(chain.length).toBeGreaterThanOrEqual(2);
          expect(version.versionNumber).toBe(chain[chain.length - 1].versionNumber);
          expect(version.priorValues).toBeDefined();
          expect(Object.keys(version.priorValues).length).toBeGreaterThan(0);
          expect(version.timestamp).toBeTruthy();

          const current = await readKBEntity(entityId, storagePath);
          expect(current).toBeTruthy();
          expect(current!).toContain(second.name);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: content-creator-ai, Property 4: Rejection never mutates the KB
  test("Property 4: rejection never mutates the KB", async () => {
    await fc.assert(
      fc.asyncProperty(companyArb, async (company) => {
        const entityId = `e-${randomUUID()}`;
        await writeKBEntity(
          {
            entityId,
            entityType: "company_identity",
            content: {
              companyIdentity: { ...company, id: entityId },
            },
            emitEvent: false,
          },
          storagePath,
        );
        const before = entityStorageFingerprint(entityId, storagePath);
        await discardDraftWithoutMutation(entityId, storagePath);
        const after = entityStorageFingerprint(entityId, storagePath);
        expect(after).toBe(before);

        // Overwrite of snapshot must throw
        const chain = await getVersionChain(entityId, storagePath);
        const snap = chain[0].snapshotPath;
        expect(() => assertSnapshotImmutable(snap)).toThrow(
          SnapshotImmutableError,
        );
      }),
      { numRuns: 100 },
    );
  });

  // Feature: content-creator-ai, Property 5: KB Markdown serialisation preserves required sections
  test("Property 5: KB Markdown serialisation preserves required sections", () => {
    fc.assert(
      fc.property(
        companyArb,
        fc.array(productArb, { minLength: 1, maxLength: 3 }),
        fc.array(personaArb, { minLength: 1, maxLength: 3 }),
        fc.array(experimentArb, { minLength: 1, maxLength: 3 }),
        (company, products, audiences, experiments) => {
          const md = serialiseToMarkdown({
            companyIdentity: company,
            products,
            audiences,
            experiments,
          });
          for (const section of REQUIRED_SECTIONS) {
            if (!md.includes(`# ${section}`)) return false;
          }
          const validation = validateMarkdownSections(md, {
            companyIdentity: true,
            products: true,
            audiences: true,
            experiments: true,
          });
          if (!validation.valid) return false;

          const parsed = parseFromMarkdown(md);
          return (
            parsed.sectionsPresent.Company_Identity &&
            parsed.sectionsPresent.Products &&
            parsed.sectionsPresent.Audiences &&
            parsed.sectionsPresent.Experiments &&
            parsed.sectionsNonEmpty.Company_Identity &&
            parsed.sectionsNonEmpty.Products &&
            parsed.sectionsNonEmpty.Audiences &&
            parsed.sectionsNonEmpty.Experiments
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: content-creator-ai, Property 6: Version history is append-only and monotonically ordered
  test("Property 6: version history is append-only and monotonically ordered", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(companyArb, { minLength: 1, maxLength: 8 }),
        async (mutations) => {
          const entityId = `e-${randomUUID()}`;
          let chain = await getVersionChain(entityId, storagePath);
          const initialLength = chain.length;

          for (const mutation of mutations) {
            await writeKBEntity(
              {
                entityId,
                entityType: "company_identity",
                content: {
                  companyIdentity: { ...mutation, id: entityId },
                },
                emitEvent: false,
              },
              storagePath,
            );
            const newChain = await getVersionChain(entityId, storagePath);
            if (newChain.length <= chain.length) return false;
            for (let i = 1; i < newChain.length; i++) {
              if (
                newChain[i].versionNumber <= newChain[i - 1].versionNumber
              ) {
                return false;
              }
            }
            // Snapshots must remain immutable
            for (const v of newChain) {
              try {
                assertSnapshotImmutable(v.snapshotPath);
                return false; // should have thrown
              } catch (e) {
                if (!(e instanceof SnapshotImmutableError)) return false;
              }
            }
            chain = newChain;
          }
          return chain.length >= initialLength + mutations.length;
        },
      ),
      { numRuns: 100 },
    );
  });

  test("storage path respects KB_STORAGE_PATH", () => {
    expect(resolveKBStoragePath()).toBe(storagePath);
  });
});

// Feature: content-creator-ai, Property 2: Company summary always contains required structural fields
describe("Context_Agent company summary property tests", () => {
  // Arbitrary page content: any length, any script, markdown or not. Deliberately
  // includes empty page sets and content with no company-like structure at all.
  const pageArb = fc.record({
    url: fc.oneof(
      fc.constant(""),
      fc.webUrl(),
      fc.string({ maxLength: 30 }),
    ),
    title: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
    markdown: fc.string({ maxLength: 400 }),
  });

  test("Property 2: summary always has name, mission, brand voice and >= 1 product", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(pageArb, { minLength: 0, maxLength: 6 }),
        fc.option(fc.webUrl(), { nil: undefined }),
        async (pages, sourceUrl) => {
          // No LLM: exercises the deterministic fallback chain that makes this
          // property unconditional.
          const { summary } = await buildCompanySummary({ pages, sourceUrl });

          if (summary.name.trim().length === 0) return false;
          if (summary.mission.trim().length === 0) return false;
          if (summary.brandVoice.trim().length === 0) return false;
          if (!Array.isArray(summary.products) || summary.products.length < 1) {
            return false;
          }
          // Every product entry must itself be identifiable.
          return summary.products.every(
            (p) => p.id.trim().length > 0 && p.name.trim().length > 0,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  test("Property 2 holds for zero scraped pages", async () => {
    const { summary, warnings } = await buildCompanySummary({ pages: [] });
    expect(summary.name.trim()).not.toBe("");
    expect(summary.mission.trim()).not.toBe("");
    expect(summary.brandVoice.trim()).not.toBe("");
    expect(summary.products.length).toBeGreaterThanOrEqual(1);
    // The operator is told the fields were derived rather than scraped.
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("Property 2 holds for non-Latin content", async () => {
    const { summary } = await buildCompanySummary({
      pages: [
        {
          url: "https://例え.jp",
          title: "株式会社サンプル",
          markdown: "# 株式会社サンプル\n\n私たちの使命は、顧客に価値を届けることです。",
        },
      ],
      sourceUrl: "https://例え.jp",
    });
    expect(summary.name).toContain("株式会社サンプル");
    expect(summary.mission.trim()).not.toBe("");
    expect(summary.brandVoice.trim()).not.toBe("");
    expect(summary.products.length).toBeGreaterThanOrEqual(1);
  });
});
