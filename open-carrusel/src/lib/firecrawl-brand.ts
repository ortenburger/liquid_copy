/**
 * Firecrawl scrape → Open Carrusel BrandConfig fields.
 * Uses the `branding` format for colors/fonts/logo, plus markdown for name fallback.
 */

import type { BrandColors, BrandFonts, BrandConfig } from "@/types/brand";
import { DEFAULT_BRAND } from "@/types/brand";

const STYLE_OPTIONS = [
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
] as const;

export interface FirecrawlBrandingProfile {
  colorScheme?: string;
  logo?: string | null;
  colors?: Partial<Record<string, string>>;
  fonts?: Array<{ family?: string; role?: string }>;
  typography?: {
    fontFamilies?: { primary?: string; heading?: string; body?: string };
  };
  images?: { logo?: string; favicon?: string; ogImage?: string };
  personality?: {
    tone?: string;
    energy?: string;
    targetAudience?: string;
  };
}

export interface BrandFromUrlResult {
  ok: boolean;
  error?: string;
  /** Partial brand patch — only fields Firecrawl could infer. */
  patch: {
    name?: string;
    websiteUrl?: string;
    colors?: Partial<BrandColors>;
    fonts?: Partial<BrandFonts>;
    logoPath?: string | null;
    styleKeywords?: string[];
  };
  filled: string[];
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim());
}

function normalizeHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return v.toLowerCase();
}

function nameFromUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    if (!label) return undefined;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return undefined;
  }
}

function nameFromMarkdown(markdown: string, title?: string): string | undefined {
  if (title) {
    const lead = title.split(/\s[|—–:·]\s|\s-\s/)[0]?.trim();
    const candidate = (lead && lead.length >= 2 ? lead : title).trim();
    if (candidate && !/^(home|welcome|index)$/i.test(candidate)) {
      return candidate.slice(0, 80);
    }
  }
  const h1 = markdown.match(/^\s{0,3}#\s+(.+)$/m);
  if (h1?.[1]) {
    const text = h1[1].replace(/[*_`]/g, "").trim();
    if (text) return text.slice(0, 80);
  }
  return undefined;
}

function mapPersonalityToKeywords(
  personality?: FirecrawlBrandingProfile["personality"],
): string[] {
  if (!personality) return [];
  const blob = [personality.tone, personality.energy, personality.targetAudience]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hits = STYLE_OPTIONS.filter((k) => blob.includes(k));
  if (hits.length > 0) return [...hits];

  const inferred: string[] = [];
  if (/modern|tech|clean|simple/.test(blob)) inferred.push("modern", "minimal");
  if (/bold|loud|high/.test(blob)) inferred.push("bold");
  if (/play|fun|casual/.test(blob)) inferred.push("playful");
  if (/luxury|premium|elegant/.test(blob)) inferred.push("luxury", "elegant");
  if (/corp|business|enterprise|professional/.test(blob))
    inferred.push("corporate", "professional");
  if (/creat|design|art/.test(blob)) inferred.push("creative");
  return [...new Set(inferred)].slice(0, 4);
}

function mapColors(
  branding?: FirecrawlBrandingProfile,
): Partial<BrandColors> | undefined {
  const c = branding?.colors;
  if (!c) return undefined;
  const out: Partial<BrandColors> = {};
  if (isHex(c.primary)) out.primary = normalizeHex(c.primary);
  if (isHex(c.secondary)) out.secondary = normalizeHex(c.secondary);
  if (isHex(c.accent)) out.accent = normalizeHex(c.accent);
  if (isHex(c.background)) out.background = normalizeHex(c.background);
  const surface =
    (isHex(c.surface) && c.surface) ||
    (isHex(c.background) && c.background) ||
    undefined;
  if (surface) out.surface = normalizeHex(surface);
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapFonts(branding?: FirecrawlBrandingProfile): Partial<BrandFonts> | undefined {
  const families = branding?.typography?.fontFamilies;
  const list = branding?.fonts ?? [];
  const heading =
    families?.heading ||
    families?.primary ||
    list.find((f) => /head/i.test(f.role ?? ""))?.family ||
    list[0]?.family;
  const body =
    families?.body ||
    families?.primary ||
    list.find((f) => /body|primary/i.test(f.role ?? ""))?.family ||
    list[1]?.family ||
    list[0]?.family;
  const out: Partial<BrandFonts> = {};
  if (heading?.trim()) out.heading = heading.trim();
  if (body?.trim()) out.body = body.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapLogo(branding?: FirecrawlBrandingProfile): string | null {
  const logo =
    branding?.logo ||
    branding?.images?.logo ||
    branding?.images?.favicon ||
    null;
  if (!logo || typeof logo !== "string") return null;
  // Prefer http(s) or data URLs that the UI can render.
  if (/^(https?:|data:image\/)/i.test(logo)) return logo;
  return null;
}

/** Merge scrape patch into current brand — never overwrite non-empty user values. */
export function mergeBrandFill(
  current: BrandConfig,
  patch: BrandFromUrlResult["patch"],
): { brand: BrandConfig; filled: string[] } {
  const filled: string[] = [];
  const next: BrandConfig = {
    ...current,
    colors: { ...current.colors },
    fonts: { ...current.fonts },
    styleKeywords: [...current.styleKeywords],
  };

  if (patch.websiteUrl && !current.websiteUrl?.trim()) {
    next.websiteUrl = patch.websiteUrl;
    filled.push("websiteUrl");
  }

  if (patch.name?.trim() && !current.name.trim()) {
    next.name = patch.name.trim();
    filled.push("name");
  }

  if (patch.colors) {
    for (const key of Object.keys(patch.colors) as (keyof BrandColors)[]) {
      const value = patch.colors[key];
      if (!value) continue;
      const isDefault =
        !current.colors[key] ||
        current.colors[key].toLowerCase() ===
          DEFAULT_BRAND.colors[key].toLowerCase();
      if (isDefault) {
        next.colors[key] = value;
        filled.push(`colors.${key}`);
      }
    }
  }

  if (patch.fonts) {
    for (const key of Object.keys(patch.fonts) as (keyof BrandFonts)[]) {
      const value = patch.fonts[key];
      if (!value) continue;
      const isDefault =
        !current.fonts[key] ||
        current.fonts[key] === DEFAULT_BRAND.fonts[key];
      if (isDefault) {
        next.fonts[key] = value;
        filled.push(`fonts.${key}`);
      }
    }
  }

  if (patch.logoPath && !current.logoPath) {
    next.logoPath = patch.logoPath;
    filled.push("logo");
  }

  if (
    patch.styleKeywords &&
    patch.styleKeywords.length > 0 &&
    current.styleKeywords.length === 0
  ) {
    next.styleKeywords = patch.styleKeywords;
    filled.push("styleKeywords");
  }

  return { brand: next, filled };
}

export async function scrapeBrandFromUrl(options: {
  url: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<BrandFromUrlResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey =
    options.apiKey?.trim() ||
    process.env.FIRECRAWL_API_KEY?.trim() ||
    "";

  if (!apiKey) {
    return {
      ok: false,
      error:
        "Missing Firecrawl API key. Set FIRECRAWL_API_KEY or paste a key in brand setup.",
      patch: {},
      filled: [],
    };
  }

  let url: string;
  try {
    const parsed = new URL(options.url.trim());
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error("URL must be http(s)");
    }
    url = parsed.toString();
  } catch {
    return {
      ok: false,
      error: "Enter a valid website URL (https://…).",
      patch: {},
      filled: [],
    };
  }

  const base = (
    process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev"
  ).replace(/\/$/, "");

  const res = await fetchImpl(`${base}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["branding", "markdown"],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Firecrawl responded ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`,
      patch: {},
      filled: [],
    };
  }

  const body = (await res.json()) as {
    success?: boolean;
    error?: string;
    data?: {
      branding?: FirecrawlBrandingProfile;
      markdown?: string;
      metadata?: { title?: string; sourceURL?: string };
    };
    branding?: FirecrawlBrandingProfile;
    markdown?: string;
  };

  if (body.success === false || body.error) {
    return {
      ok: false,
      error: body.error ?? "Firecrawl scrape failed",
      patch: {},
      filled: [],
    };
  }

  const data = (body.data ?? body) as {
    branding?: FirecrawlBrandingProfile;
    markdown?: string;
    metadata?: { title?: string; sourceURL?: string };
  };
  const branding = data.branding ?? body.branding;
  const markdown = data.markdown ?? body.markdown ?? "";
  const title = data.metadata?.title;

  const name =
    nameFromMarkdown(markdown, title) ?? nameFromUrl(url) ?? undefined;
  const colors = mapColors(branding);
  const fonts = mapFonts(branding);
  const logoPath = mapLogo(branding);
  const styleKeywords = mapPersonalityToKeywords(branding?.personality);

  const patch: BrandFromUrlResult["patch"] = { websiteUrl: url };
  const filled: string[] = ["websiteUrl"];
  if (name) {
    patch.name = name;
    filled.push("name");
  }
  if (colors) {
    patch.colors = colors;
    filled.push(...Object.keys(colors).map((k) => `colors.${k}`));
  }
  if (fonts) {
    patch.fonts = fonts;
    filled.push(...Object.keys(fonts).map((k) => `fonts.${k}`));
  }
  if (logoPath) {
    patch.logoPath = logoPath;
    filled.push("logo");
  }
  if (styleKeywords.length > 0) {
    patch.styleKeywords = styleKeywords;
    filled.push("styleKeywords");
  }

  return { ok: true, patch, filled };
}
