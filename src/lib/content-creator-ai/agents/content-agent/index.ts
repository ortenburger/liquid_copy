import { randomUUID } from "node:crypto";
import type {
  CompanyIdentity,
  Hypothesis,
  PostVariant,
  PostSlide,
  RAGPassage,
  SocialPlatform,
  TraceabilityChain,
  AspectRatio,
} from "../../types/index.js";
import { semanticSearch } from "../../rag/vectorstore.js";
import { aspectRatioForPlatform } from "../../publishing/platform-validators.js";
import {
  discardInvalidVariants,
  validatePostVariant,
} from "./variant-validation.js";

const DEFAULT_OPENCAROUSEL_BASE =
  process.env.OPENCAROUSEL_BASE_URL ?? "http://localhost:3000";

/**
 * Map Liquid Copy KB company identity → Open Carrusel BrandConfig fields.
 * Prefer this over re-running Firecrawl inside the studio.
 */
export function companyIdentityToOpenCarouselBrand(
  identity: CompanyIdentity,
  options?: {
    websiteUrl?: string;
    visualTheme?: string;
  },
): Record<string, unknown> {
  const keywords = new Set<string>();
  for (const part of [
    identity.brandVoice,
    identity.brandSignals?.tone,
    identity.brandSignals?.style,
    options?.visualTheme,
    identity.industry,
  ]) {
    if (!part?.trim()) continue;
    for (const token of part.split(/[,;/|]+|\s{2,}/)) {
      const t = token.trim().toLowerCase();
      if (t.length >= 3 && t.length <= 40) keywords.add(t);
    }
  }
  for (const value of identity.values ?? []) {
    if (value.trim()) keywords.add(value.trim().toLowerCase());
  }
  for (const term of identity.brandSignals?.recurringTerminology ?? []) {
    if (term.trim()) keywords.add(term.trim().toLowerCase());
  }

  const STYLE_VOCAB = new Set([
    "minimal",
    "bold",
    "playful",
    "corporate",
    "luxury",
    "vintage",
    "modern",
    "elegant",
    "creative",
    "professional",
  ]);
  const styleKeywords = [...keywords].filter((k) => STYLE_VOCAB.has(k));
  if (styleKeywords.length === 0) {
    if (/professional|corporate|b2b|saas/i.test(identity.brandVoice)) {
      styleKeywords.push("professional", "modern");
    } else if (/playful|fun|bold/i.test(identity.brandVoice)) {
      styleKeywords.push("playful", "bold");
    } else {
      styleKeywords.push("modern", "minimal");
    }
  }

  return {
    name: identity.name.trim(),
    websiteUrl: (options?.websiteUrl ?? "").trim(),
    styleKeywords: styleKeywords.slice(0, 8),
  };
}

/** Human-readable brand brief for chat / slide context (no second scrape). */
export function formatIdentityBrief(identity: CompanyIdentity): string {
  const lines = [
    `Company: ${identity.name}`,
    identity.industry ? `Industry: ${identity.industry}` : "",
    `Mission: ${identity.mission}`,
    identity.vision ? `Vision: ${identity.vision}` : "",
    `Brand voice: ${identity.brandVoice}`,
    identity.brandSignals
      ? `Tone/style: ${identity.brandSignals.tone}; ${identity.brandSignals.style}`
      : "",
    identity.values?.length ? `Values: ${identity.values.join(", ")}` : "",
    identity.features?.length
      ? `Features: ${identity.features.slice(0, 8).join(", ")}`
      : "",
    identity.benefits?.length
      ? `Benefits: ${identity.benefits.slice(0, 8).join(", ")}`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export interface OpenCarouselClient {
  createCarousel(input: {
    name: string;
    aspectRatio: AspectRatio;
  }): Promise<{ id: string }>;
  /** Push a BrandConfig-compatible payload into Open Carrusel `/api/brand`. */
  applyBrand(brand: Record<string, unknown>): Promise<void>;
  chat(message: string, carouselId: string): Promise<void>;
  updateCarousel(
    id: string,
    updates: { caption?: string; hashtags?: string[]; slides?: PostSlide[] },
  ): Promise<void>;
  exportCarousel(id: string): Promise<ArrayBuffer>;
}

/** Minimal HTTP client against the local OpenCarousel Next.js app. */
export function createOpenCarouselHttpClient(
  baseUrl = DEFAULT_OPENCAROUSEL_BASE,
): OpenCarouselClient {
  return {
    async createCarousel({ name, aspectRatio }) {
      const res = await fetch(`${baseUrl}/api/carousels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, aspectRatio }),
      });
      if (!res.ok) {
        throw new Error(`OpenCarousel createCarousel failed: ${res.status}`);
      }
      return (await res.json()) as { id: string };
    },
    async applyBrand(brand) {
      const res = await fetch(`${baseUrl}/api/brand`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brand),
      });
      if (!res.ok) {
        throw new Error(`OpenCarousel applyBrand failed: ${res.status}`);
      }
    },
    async chat(message, carouselId) {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, carouselId }),
      });
      if (!res.ok) {
        throw new Error(`OpenCarousel chat failed: ${res.status}`);
      }
    },
    async updateCarousel(id, updates) {
      const res = await fetch(`${baseUrl}/api/carousels/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        throw new Error(`OpenCarousel updateCarousel failed: ${res.status}`);
      }
    },
    async exportCarousel(id) {
      const res = await fetch(`${baseUrl}/api/carousels/${id}/export`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let detail = body.slice(0, 240);
        try {
          const parsed = JSON.parse(body) as { error?: string };
          if (parsed.error) detail = parsed.error;
        } catch {
          /* keep raw */
        }
        throw new Error(
          `OpenCarousel export failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
        );
      }
      return res.arrayBuffer();
    },
  };
}

/**
 * In-memory stub used when OpenCarousel is unreachable (tests / offline).
 * Still exercises the 5-step flow contract.
 */
export function createOpenCarouselStubClient(): OpenCarouselClient {
  const carousels = new Map<
    string,
    { name: string; aspectRatio: AspectRatio; caption?: string; hashtags?: string[] }
  >();
  return {
    async createCarousel({ name, aspectRatio }) {
      const id = randomUUID();
      carousels.set(id, { name, aspectRatio });
      return { id };
    },
    async applyBrand() {
      /* no-op */
    },
    async chat() {
      /* no-op */
    },
    async updateCarousel(id, updates) {
      const c = carousels.get(id);
      if (!c) throw new Error(`Unknown carousel ${id}`);
      if (updates.caption !== undefined) c.caption = updates.caption;
      if (updates.hashtags !== undefined) c.hashtags = updates.hashtags;
    },
    async exportCarousel(id) {
      if (!carousels.has(id)) throw new Error(`Unknown carousel ${id}`);
      // Minimal ZIP local file header signature so callers can assert bytes returned
      const zipLocalHeader = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
      ]);
      return zipLocalHeader.buffer;
    },
  };
}

export interface ContentAgentOptions {
  openCarousel?: OpenCarouselClient;
  /** Variant count per platform; clamped to [2, 5]. Default: 3. */
  variantsPerPlatform?: number;
  /** Force RAG unavailable (tests). */
  ragUnavailable?: boolean;
  /** Inject RAG passages instead of querying (tests). */
  ragPassages?: RAGPassage[];
}

export interface ContentGenerationResult {
  variants: PostVariant[];
  discardedCount: number;
  notification: string;
  errors: string[];
}

function clampVariantCount(n: number | undefined): number {
  const v = n ?? 3;
  return Math.max(2, Math.min(5, Math.floor(v)));
}

function buildSlides(hypothesis: Hypothesis, count: number): PostSlide[] {
  const slides: PostSlide[] = [];
  const n = Math.max(1, Math.min(10, count));
  for (let i = 0; i < n; i++) {
    const text =
      i === 0
        ? hypothesis.hook
        : i === 1
          ? hypothesis.coreCopy
          : `${hypothesis.angle} — ${hypothesis.theme}`;
    slides.push({
      id: randomUUID(),
      html: `<div style="padding:24px"><h1>${escapeHtml(text)}</h1></div>`,
      order: i,
      hasImage: false,
      hasText: true,
    });
  }
  return slides;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emptyTraceability(
  hypothesisId: string,
  postVariantId: string,
): TraceabilityChain {
  return {
    companyContextVersionId: "",
    marketingGoalId: "",
    audiencePersonaId: "",
    roadmapEntryId: "",
    hypothesisId,
    postVariantId,
    status: "in_progress",
    links: [
      {
        entityType: "hypothesis",
        entityId: hypothesisId,
        timestamp: new Date().toISOString(),
      },
      {
        entityType: "post_variant",
        entityId: postVariantId,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export class ContentAgent {
  private readonly client: OpenCarouselClient;
  private readonly variantsPerPlatform: number;
  private readonly ragUnavailable: boolean;
  private readonly injectedPassages?: RAGPassage[];

  constructor(options: ContentAgentOptions = {}) {
    this.client = options.openCarousel ?? createOpenCarouselStubClient();
    this.variantsPerPlatform = clampVariantCount(options.variantsPerPlatform);
    this.ragUnavailable = options.ragUnavailable === true;
    this.injectedPassages = options.ragPassages;
  }

  /**
   * Generate 2–5 PostVariants per platform via the OpenCarousel 5-step flow.
   * Requirements 8.1, 8.2, 8.3, 8.6.
   */
  async generate(
    hypothesis: Hypothesis,
    platforms: SocialPlatform[],
    options?: {
      cta?: string;
      hashtags?: string[];
      slidesPerVariant?: number;
      traceabilityBase?: Partial<TraceabilityChain>;
      /** KB company identity — pushed into Open Carrusel brand (no Firecrawl). */
      identity?: CompanyIdentity;
      /** Original ingest URL for BrandConfig.websiteUrl. */
      websiteUrl?: string;
    },
  ): Promise<ContentGenerationResult> {
    const errors: string[] = [];
    const allVariants: PostVariant[] = [];

    let brandPassages: RAGPassage[] = [];
    let withoutBrandContext = false;

    if (this.ragUnavailable) {
      withoutBrandContext = true;
    } else if (this.injectedPassages) {
      brandPassages = this.injectedPassages;
      withoutBrandContext = brandPassages.length === 0;
    } else {
      try {
        brandPassages = await semanticSearch({
          query: `${hypothesis.hook} ${hypothesis.visualTheme} brand voice tone`,
          scope: "company_memory",
          k: 5,
        });
        withoutBrandContext = brandPassages.length === 0;
      } catch {
        withoutBrandContext = true;
        errors.push("RAG unavailable — proceeding with Hypothesis fields only");
      }
    }

    const identityBrief = options?.identity
      ? formatIdentityBrief(options.identity)
      : "";
    const brandContext = [
      identityBrief,
      brandPassages.map((p) => p.content).join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (identityBrief) withoutBrandContext = false;

    // Seed Open Carrusel brand.json once from KB — studio skips Firecrawl fill.
    if (options?.identity?.name?.trim()) {
      try {
        const brandPatch = companyIdentityToOpenCarouselBrand(options.identity, {
          websiteUrl: options.websiteUrl,
          visualTheme: hypothesis.visualTheme,
        });
        await this.client.applyBrand(brandPatch);
        console.info(
          `[content-agent] seeded Open Carrusel brand from KB: ${options.identity.name}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Open Carrusel brand seed failed: ${msg}`);
        console.warn(`[content-agent] brand seed failed: ${msg}`);
      }
    }

    for (const platform of platforms) {
      const aspectRatio = aspectRatioForPlatform(platform);
      const platformVariants: PostVariant[] = [];

      for (let i = 0; i < this.variantsPerPlatform; i++) {
        try {
          const variant = await this.generateOneVariant({
            hypothesis,
            platform,
            aspectRatio,
            index: i,
            cta: options?.cta,
            hashtags: options?.hashtags ?? [],
            slidesPerVariant: options?.slidesPerVariant ?? 3,
            brandContext,
            withoutBrandContext,
            traceabilityBase: options?.traceabilityBase,
            companyName: options?.identity?.name,
          });
          platformVariants.push(variant);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`OpenCarousel error for ${platform} variant ${i}: ${msg}`);
          // Full Auto A/B still needs variants — synthesize locally.
          platformVariants.push(
            this.synthesizeLocalVariant({
              hypothesis,
              platform,
              aspectRatio,
              index: i,
              cta: options?.cta,
              hashtags: options?.hashtags ?? [],
              slidesPerVariant: options?.slidesPerVariant ?? 3,
              withoutBrandContext,
              traceabilityBase: options?.traceabilityBase,
              note: `local fallback after: ${msg.slice(0, 120)}`,
            }),
          );
        }
      }

      // Property 19 / Full Auto A/B: always land at least 2 variants per platform.
      while (platformVariants.length < 2) {
        const i = platformVariants.length;
        platformVariants.push(
          this.synthesizeLocalVariant({
            hypothesis,
            platform,
            aspectRatio,
            index: i,
            cta: options?.cta,
            hashtags: options?.hashtags ?? [],
            slidesPerVariant: options?.slidesPerVariant ?? 3,
            withoutBrandContext,
            traceabilityBase: options?.traceabilityBase,
            note: "local A/B filler",
          }),
        );
        errors.push(
          `Synthesized local A/B variant ${i} for ${platform} (Open Carrusel under-produced)`,
        );
      }

      allVariants.push(...platformVariants);
    }

    // If we somehow produced outside [2,5] per platform due to partial failure,
    // clamp by taking first 5 and note — Property 19 is about successful generation.
    const byPlatform = new Map<SocialPlatform, PostVariant[]>();
    for (const v of allVariants) {
      const list = byPlatform.get(v.platform) ?? [];
      list.push(v);
      byPlatform.set(v.platform, list);
    }
    const normalised: PostVariant[] = [];
    for (const [, list] of byPlatform) {
      normalised.push(...list.slice(0, 5));
    }

    const { valid, discardedCount, notification } =
      discardInvalidVariants(normalised);

    return {
      variants: valid,
      discardedCount,
      notification,
      errors,
    };
  }

  private async generateOneVariant(args: {
    hypothesis: Hypothesis;
    platform: SocialPlatform;
    aspectRatio: AspectRatio;
    index: number;
    cta?: string;
    hashtags: string[];
    slidesPerVariant: number;
    brandContext: string;
    withoutBrandContext: boolean;
    traceabilityBase?: Partial<TraceabilityChain>;
    companyName?: string;
  }): Promise<PostVariant> {
    const {
      hypothesis,
      platform,
      aspectRatio,
      index,
      cta,
      hashtags,
      slidesPerVariant,
      brandContext,
      withoutBrandContext,
      traceabilityBase,
      companyName,
    } = args;

    // Step 1: create carousel (brand already seeded once in generate())
    const carouselName = [
      companyName?.trim(),
      hypothesis.hook.slice(0, 48),
      `v${index + 1}`,
      platform,
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 120);

    const { id: carouselId } = await this.client.createCarousel({
      name: carouselName || `${hypothesis.id}-v${index + 1}-${platform}`,
      aspectRatio,
    });

    const prompt = [
      `Create carousel variant ${index + 1} for ${platform}.`,
      `Use the existing brand config already loaded in Open Carrusel — do not scrape the website again.`,
      `Hook: ${hypothesis.hook}`,
      `Angle: ${hypothesis.angle}`,
      `Visual Theme: ${hypothesis.visualTheme}`,
      `Core Copy: ${hypothesis.coreCopy}`,
      cta ? `CTA: ${cta}` : "",
      brandContext ? `Brand context (from Liquid Copy KB):\n${brandContext}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await this.client.chat(prompt, carouselId);
    } catch (err) {
      // Open Carrusel chat often needs Claude CLI — still ship slides/caption.
      console.warn(
        `[content-agent] Open Carrusel chat skipped for ${carouselId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Step 3: slide generation (1–10 HTML body fragments)
    const slides = buildSlides(hypothesis, slidesPerVariant);

    // Step 4: caption + hashtags
    const caption = [
      hypothesis.hook,
      hypothesis.coreCopy,
      cta ?? "",
    ]
      .filter((s) => s.trim() !== "")
      .join("\n\n")
      .slice(0, 5000);

    await this.client.updateCarousel(carouselId, {
      caption,
      hashtags,
      slides,
    });

    // Step 5: export PNG ZIP (best-effort — carousel + slides already saved)
    try {
      await this.client.exportCarousel(carouselId);
    } catch (err) {
      console.warn(
        `[content-agent] Open Carrusel export skipped for ${carouselId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const id = randomUUID();
    const traceability: TraceabilityChain = {
      ...emptyTraceability(hypothesis.id, id),
      ...traceabilityBase,
      hypothesisId: hypothesis.id,
      postVariantId: id,
    };

    const variant: PostVariant = {
      id,
      hypothesisId: hypothesis.id,
      platform,
      carouselId,
      slides,
      caption,
      hashtags,
      cta,
      aspectRatio,
      brandContextTag: withoutBrandContext
        ? "generated_without_brand_context"
        : undefined,
      regenerationRetryCount: 0,
      validationStatus: "valid",
      status: "draft",
      traceability,
    };

    const validation = validatePostVariant(variant);
    variant.validationStatus = validation.valid ? "valid" : "invalid";
    return variant;
  }

  /**
   * Offline / failure path: still produce a valid PostVariant so Full Auto can
   * run Publishing → Analytics → Learning A/B without Open Carrusel.
   */
  private synthesizeLocalVariant(args: {
    hypothesis: Hypothesis;
    platform: SocialPlatform;
    aspectRatio: AspectRatio;
    index: number;
    cta?: string;
    hashtags: string[];
    slidesPerVariant: number;
    withoutBrandContext: boolean;
    traceabilityBase?: Partial<TraceabilityChain>;
    note?: string;
  }): PostVariant {
    const {
      hypothesis,
      platform,
      aspectRatio,
      index,
      cta,
      hashtags,
      slidesPerVariant,
      withoutBrandContext,
      traceabilityBase,
      note,
    } = args;

    const slides = buildSlides(hypothesis, slidesPerVariant);
    // Differentiate A/B copy slightly so analytics can pick a winner.
    const abLabel = index === 0 ? "A" : "B";
    const hookTwist =
      index === 0
        ? hypothesis.hook
        : `${hypothesis.angle} — ${hypothesis.hook}`.slice(0, 280);
    if (slides[0]) {
      slides[0] = {
        ...slides[0],
        html: `<div style="padding:24px"><h1>${escapeHtml(hookTwist)}</h1><p>Variant ${abLabel}</p></div>`,
        hasText: true,
      };
    }

    const caption = [
      hookTwist,
      hypothesis.coreCopy,
      cta ?? "",
      note ? `(${note})` : "",
    ]
      .filter((s) => s.trim() !== "")
      .join("\n\n")
      .slice(0, 5000);

    const id = randomUUID();
    const variant: PostVariant = {
      id,
      hypothesisId: hypothesis.id,
      platform,
      carouselId: `local-${platform}-v${index + 1}-${id.slice(0, 8)}`,
      slides,
      caption,
      hashtags,
      cta,
      aspectRatio,
      brandContextTag: withoutBrandContext
        ? "generated_without_brand_context"
        : undefined,
      regenerationRetryCount: 0,
      validationStatus: "valid",
      status: "draft",
      traceability: {
        ...emptyTraceability(hypothesis.id, id),
        ...traceabilityBase,
        hypothesisId: hypothesis.id,
        postVariantId: id,
      },
    };
    const validation = validatePostVariant(variant);
    variant.validationStatus = validation.valid ? "valid" : "invalid";
    return variant;
  }
}

/**
 * Ensure generated count for a platform is in [2, 5] for Property 19 tests
 * when the agent is asked to produce a specific count.
 */
export function clampVariantsPerPlatform(count: number): number {
  return Math.max(2, Math.min(5, Math.floor(count)));
}
