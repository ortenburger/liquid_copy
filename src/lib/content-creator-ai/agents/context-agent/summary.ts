/**
 * Company summary extraction from scraped pages (supports Task 5.3).
 *
 * Requirement 1.1 / 1.5 and Property 2: the produced summary must ALWAYS carry a
 * company name, mission, brand voice and at least one product entry — for any
 * scraped content, whatever its length, language or page count. Every field
 * therefore has a deterministic fallback chain ending in a derived value, and
 * the optional LLM refinement can only fill blanks, never empty a field.
 */
import type { BrandSignals, CompanyIdentity, Product } from "../../types/index.js";
import type { FirecrawlPage } from "../../integrations/firecrawl.js";
import { parseJSONFromLLM, type LLMClient } from "../../integrations/llm.js";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "we", "us", "are", "is",
  "was", "were", "this", "that", "these", "those", "from", "have", "has", "had",
  "not", "but", "all", "can", "will", "more", "about", "into", "than", "then",
  "them", "they", "their", "there", "here", "what", "when", "which", "who",
  "how", "why", "out", "get", "one", "also", "been", "being", "over", "just",
  "any", "each", "own", "same", "such", "only", "other", "some", "most", "new",
  "home", "page", "site", "click", "learn", "read", "sign", "log",
]);

const MISSION_HINTS = [
  "our mission", "mission is", "we believe", "we help", "we exist",
  "our purpose", "we make", "we build", "we empower", "about us",
];

const PRODUCT_HEADING_HINTS = [
  "product", "products", "service", "services", "solution", "solutions",
  "pricing", "plans", "features", "offering", "offerings", "what we do",
];

const VALUE_HEADING_HINTS = ["value", "values", "principles", "what we stand for"];
const BENEFIT_HEADING_HINTS = ["benefit", "benefits", "why", "outcomes", "results"];
const FEATURE_HEADING_HINTS = ["feature", "features", "capabilities", "how it works"];

interface Heading {
  level: number;
  text: string;
  /** Bullet items and short lines that follow, until the next heading. */
  items: string[];
  body: string;
}

/** Strip markdown emphasis, links and images down to readable text. */
function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHeadings(markdown: string): Heading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: Heading[] = [];
  let current: Heading | null = null;

  for (const line of lines) {
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) {
      if (current) headings.push(current);
      current = { level: h[1].length, text: plain(h[2]), items: [], body: "" };
      continue;
    }
    if (!current) continue;
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const item = plain(bullet[1]);
      if (item) current.items.push(item);
    } else {
      const text = plain(line);
      if (text) current.body += (current.body ? " " : "") + text;
    }
  }
  if (current) headings.push(current);
  return headings;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Derive a company name from a page title, H1 or the source hostname. */
export function deriveCompanyName(
  pages: FirecrawlPage[],
  sourceUrl?: string,
): string | undefined {
  for (const page of pages) {
    const title = page.title ? plain(page.title) : "";
    if (title) {
      // Titles are usually "Acme — Widgets for teams"; keep the leading segment.
      const lead = title.split(/\s[|—–:·]\s|\s-\s/)[0]?.trim();
      const candidate = (lead && lead.length >= 2 ? lead : title).trim();
      if (candidate && !/^(home|welcome|index)$/i.test(candidate)) {
        return candidate.slice(0, 80);
      }
    }
  }
  for (const page of pages) {
    const h1 = parseHeadings(page.markdown).find((h) => h.level === 1);
    if (h1?.text) return h1.text.slice(0, 80);
  }
  const url = sourceUrl ?? pages.find((p) => p.url)?.url;
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      const label = host.split(".")[0];
      if (label) return label.charAt(0).toUpperCase() + label.slice(1);
    } catch {
      // not a parseable URL — fall through
    }
  }
  return undefined;
}

function deriveMission(pages: FirecrawlPage[]): string | undefined {
  const corpus = pages.map((p) => plain(p.markdown));
  for (const text of corpus) {
    const lower = text.toLowerCase();
    for (const hint of MISSION_HINTS) {
      const at = lower.indexOf(hint);
      if (at === -1) continue;
      const sentence = sentences(text.slice(at))[0];
      if (sentence && sentence.length >= 20) return sentence.slice(0, 300);
    }
  }
  // No mission language anywhere — take the first substantive sentence.
  for (const text of corpus) {
    const sentence = sentences(text).find((s) => s.length >= 40);
    if (sentence) return sentence.slice(0, 300);
  }
  return undefined;
}

function collectUnder(
  headings: Heading[],
  hints: string[],
  limit: number,
): string[] {
  const found: string[] = [];
  for (const h of headings) {
    const lower = h.text.toLowerCase();
    if (!hints.some((hint) => lower.includes(hint))) continue;
    for (const item of h.items) {
      if (item.length >= 3 && item.length <= 160) found.push(item);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

function deriveProductNames(pages: FirecrawlPage[]): string[] {
  const names: string[] = [];
  for (const page of pages) {
    const headings = parseHeadings(page.markdown);
    names.push(...collectUnder(headings, PRODUCT_HEADING_HINTS, 10));
    // Sub-headings inside a products section are product names too.
    for (let i = 0; i < headings.length; i++) {
      const lower = headings[i].text.toLowerCase();
      if (!PRODUCT_HEADING_HINTS.some((hint) => lower.includes(hint))) continue;
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j].level <= headings[i].level) break;
        if (headings[j].text) names.push(headings[j].text);
      }
    }
    if (names.length >= 10) break;
  }
  return dedupe(names).slice(0, 10);
}

function deriveBrandSignals(pages: FirecrawlPage[]): BrandSignals {
  const corpus = pages.map((p) => plain(p.markdown)).join(" ");
  const words = corpus.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  const counts = new Map<string, number>();
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const recurring = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word]) => word);

  const exclamations = (corpus.match(/!/g) ?? []).length;
  const secondPerson = (corpus.match(/\byou\b/gi) ?? []).length;
  const sents = sentences(corpus);
  const avgLen = sents.length
    ? sents.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sents.length
    : 0;

  const tone =
    exclamations > 3 || secondPerson > 10
      ? "energetic and direct"
      : avgLen > 24
        ? "considered and authoritative"
        : "clear and professional";
  const style = avgLen > 24 ? "long-form explanatory" : "concise and scannable";

  return { tone, style, recurringTerminology: recurring };
}

export interface BuildSummaryInput {
  pages: FirecrawlPage[];
  sourceUrl?: string;
  entityId?: string;
  llm?: LLMClient;
}

/** Shape the optional LLM refinement may return. Blank values are ignored. */
interface LLMSummaryShape {
  name?: string;
  industry?: string;
  mission?: string;
  vision?: string;
  brandVoice?: string;
  values?: string[];
  products?: string[];
  features?: string[];
  benefits?: string[];
  pricing?: string;
}

/**
 * Build a structured company summary from scraped pages.
 *
 * Guarantees (Property 2): `name`, `mission`, `brandVoice` are non-empty and
 * `products` has at least one entry, for ANY input including zero pages.
 */
export async function buildCompanySummary(
  input: BuildSummaryInput,
): Promise<{ summary: CompanyIdentity; warnings: string[] }> {
  const { pages, sourceUrl, entityId, llm } = input;
  const warnings: string[] = [];

  const allHeadings = pages.flatMap((p) => parseHeadings(p.markdown));
  let name = deriveCompanyName(pages, sourceUrl);
  let mission = deriveMission(pages);
  let productNames = deriveProductNames(pages);
  let values = collectUnder(allHeadings, VALUE_HEADING_HINTS, 8);
  let features = collectUnder(allHeadings, FEATURE_HEADING_HINTS, 10);
  let benefits = collectUnder(allHeadings, BENEFIT_HEADING_HINTS, 10);
  const signals = deriveBrandSignals(pages);
  let brandVoice = `${signals.tone}; ${signals.style}`;
  let industry: string | undefined;
  let vision: string | undefined;
  let pricing: string | undefined;

  // Optional refinement. The model may only fill gaps or sharpen values; it can
  // never blank a field the heuristics already found.
  if (llm && pages.length > 0) {
    const excerpt = pages
      .slice(0, 5)
      .map((p) => `## ${p.title ?? p.url}\n${plain(p.markdown).slice(0, 1200)}`)
      .join("\n\n")
      .slice(0, 6000);
    const raw = await llm.complete(
      `Extract a company profile from the scraped website content below.\n` +
        `Reply with JSON only, using these keys: name, industry, mission, vision, brandVoice, values (array), products (array of names), features (array), benefits (array), pricing.\n` +
        `Omit any key you cannot determine. Do not invent facts.\n\n${excerpt}`,
      { temperature: 0 },
    );
    const parsed = parseJSONFromLLM<LLMSummaryShape>(raw);
    if (parsed) {
      name = firstNonEmpty(parsed.name, name);
      mission = firstNonEmpty(parsed.mission, mission);
      brandVoice = firstNonEmpty(parsed.brandVoice, brandVoice) ?? brandVoice;
      industry = firstNonEmpty(parsed.industry, industry);
      vision = firstNonEmpty(parsed.vision, vision);
      pricing = firstNonEmpty(parsed.pricing, pricing);
      values = preferNonEmpty(cleanList(parsed.values), values);
      features = preferNonEmpty(cleanList(parsed.features), features);
      benefits = preferNonEmpty(cleanList(parsed.benefits), benefits);
      productNames = preferNonEmpty(cleanList(parsed.products), productNames);
    } else if (raw !== null) {
      warnings.push("LLM refinement returned unparseable output; used heuristics");
    }
  }

  // Fallback chain — these are what make Property 2 hold unconditionally.
  if (!name) {
    name = "Unknown Company";
    warnings.push("Company name could not be determined from scraped content");
  }
  if (!mission) {
    mission = `Deliver value to ${name}'s customers`;
    warnings.push("Mission could not be determined from scraped content");
  }
  if (!brandVoice.trim()) brandVoice = "clear and professional";
  if (productNames.length === 0) {
    productNames = [`${name} core offering`];
    warnings.push("No products found in scraped content; added a placeholder entry");
  }

  const id = entityId ?? slugify(name);
  const products: Product[] = productNames.map((productName, i) => ({
    id: `${id}-product-${i + 1}`,
    name: productName,
    features,
    benefits,
    pricing,
    targetAudience: industry,
  }));

  const summary: CompanyIdentity = {
    id,
    name,
    industry,
    mission,
    vision,
    brandVoice,
    values,
    products,
    features,
    benefits,
    pricing,
    brandSignals: signals,
    businessObjectives: [],
    createdAt: new Date().toISOString(),
  };

  return { summary, warnings };
}

function firstNonEmpty(
  ...candidates: Array<string | undefined>
): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return dedupe(
    value
      .filter((v): v is string => typeof v === "string")
      .map((v) => plain(v))
      .filter((v) => v.length > 0),
  );
}

function preferNonEmpty(preferred: string[], fallback: string[]): string[] {
  return preferred.length > 0 ? preferred : fallback;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function slugify(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "company";
}
