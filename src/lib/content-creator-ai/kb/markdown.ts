import type {
  AudiencePersona,
  CompanyIdentity,
  Experiment,
  KBPayload,
  Product,
} from "../types/index.js";

const REQUIRED_SECTIONS = [
  "Company_Identity",
  "Products",
  "Audiences",
  "Experiments",
] as const;

function escapeInline(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function listBlock(items: string[] | undefined, empty = "_none_"): string {
  if (!items || items.length === 0) return empty;
  return items.map((i) => `- ${escapeInline(i)}`).join("\n");
}

function serialiseCompanyIdentity(identity?: CompanyIdentity): string {
  if (!identity) {
    return ["# Company_Identity", "", "_empty_"].join("\n");
  }
  const lines = [
    "# Company_Identity",
    "",
    `## Name`,
    escapeInline(identity.name),
    "",
    `## Mission`,
    escapeInline(identity.mission),
    "",
    `## Vision`,
    escapeInline(identity.vision ?? ""),
    "",
    `## BrandVoice`,
    escapeInline(identity.brandVoice),
    "",
    `## Values`,
    listBlock(identity.values),
    "",
    `## Features`,
    listBlock(identity.features),
    "",
    `## Benefits`,
    listBlock(identity.benefits),
    "",
    `## Pricing`,
    escapeInline(identity.pricing ?? ""),
    "",
    `## Industry`,
    escapeInline(identity.industry ?? ""),
    "",
    `## BusinessObjectives`,
    listBlock(identity.businessObjectives),
    "",
    `## Id`,
    escapeInline(identity.id),
  ];
  if (identity.brandSignals) {
    lines.push(
      "",
      "## BrandSignals",
      `tone: ${escapeInline(identity.brandSignals.tone)}`,
      `style: ${escapeInline(identity.brandSignals.style)}`,
      "terminology:",
      listBlock(identity.brandSignals.recurringTerminology),
    );
  }
  return lines.join("\n");
}

function serialiseProducts(products?: Product[]): string {
  const lines = ["# Products", ""];
  if (!products || products.length === 0) {
    lines.push("_empty_");
    return lines.join("\n");
  }
  for (const p of products) {
    lines.push(
      `## ${escapeInline(p.name)}`,
      "",
      `### Id`,
      escapeInline(p.id),
      "",
      `### Features`,
      listBlock(p.features),
      "",
      `### Benefits`,
      listBlock(p.benefits),
      "",
      `### Pricing`,
      escapeInline(p.pricing ?? ""),
      "",
      `### TargetAudience`,
      escapeInline(p.targetAudience ?? ""),
      "",
    );
  }
  return lines.join("\n");
}

function serialiseAudiences(audiences?: AudiencePersona[]): string {
  const lines = ["# Audiences", ""];
  if (!audiences || audiences.length === 0) {
    lines.push("_empty_");
    return lines.join("\n");
  }
  for (const a of audiences) {
    lines.push(
      `## ${escapeInline(a.id)}`,
      "",
      `### ICPDefinition`,
      escapeInline(a.icpDefinition),
      "",
      `### PainPoints`,
      listBlock(a.painPoints),
      "",
      `### JobsToBeDone`,
      listBlock(a.jobsToBeDone),
      "",
      `### Objections`,
      listBlock(a.objections),
      "",
      `### DreamOutcomes`,
      listBlock(a.dreamOutcomes),
      "",
      `### Source`,
      escapeInline(a.source),
      "",
      `### KbVersion`,
      escapeInline(a.kbVersion),
      "",
      `### CreatedAt`,
      escapeInline(a.createdAt),
      "",
    );
  }
  return lines.join("\n");
}

function serialiseExperiments(experiments?: Experiment[]): string {
  const lines = ["# Experiments", ""];
  if (!experiments || experiments.length === 0) {
    lines.push("_empty_");
    return lines.join("\n");
  }
  for (const e of experiments) {
    lines.push(
      `## ${escapeInline(e.id)}`,
      "",
      `### Hypothesis`,
      escapeInline(e.hypothesisId),
      "",
      `### PostVariantIDs`,
      listBlock(e.postVariantIds),
      "",
      `### PublishedDates`,
      listBlock(e.publishedDates),
      "",
      `### LessonsLearned`,
      escapeInline(e.lessonsLearned ?? ""),
      "",
      `### Status`,
      escapeInline(e.status),
      "",
      `### VersionCounter`,
      String(e.versionCounter),
      "",
      `### CreatedAt`,
      escapeInline(e.createdAt),
      "",
    );
  }
  return lines.join("\n");
}

/**
 * Serialise a KB payload to agent-friendly Markdown with the four required
 * top-level sections: Company_Identity, Products, Audiences, Experiments.
 */
export function serialiseToMarkdown(payload: KBPayload): string {
  return [
    serialiseCompanyIdentity(payload.companyIdentity),
    "",
    serialiseProducts(payload.products),
    "",
    serialiseAudiences(payload.audiences),
    "",
    serialiseExperiments(payload.experiments),
    "",
  ].join("\n");
}

function splitSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const headingRe = /^# ([^\n]+)$/gm;
  const matches = [...markdown.matchAll(headingRe)];
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : markdown.length;
    sections[name] = markdown.slice(start, end).trim();
  }
  return sections;
}

function parseList(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter((l) => l.length > 0 && l !== "_none_");
}

function subsection(body: string, heading: string): string {
  const re = new RegExp(
    `## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
    "i",
  );
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

function h3(body: string, heading: string): string {
  const re = new RegExp(
    `### ${heading}\\s*\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`,
    "i",
  );
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

function parseCompanyIdentity(body: string): CompanyIdentity | undefined {
  if (!body || body === "_empty_") return undefined;
  const name = subsection(body, "Name");
  const mission = subsection(body, "Mission");
  const brandVoice = subsection(body, "BrandVoice");
  const id = subsection(body, "Id") || "company";
  if (!name && !mission && !brandVoice) return undefined;

  const brandSignalsBlock = subsection(body, "BrandSignals");
  let brandSignals: CompanyIdentity["brandSignals"];
  if (brandSignalsBlock) {
    const tone =
      brandSignalsBlock.match(/tone:\s*(.*)/i)?.[1]?.trim() ?? "";
    const style =
      brandSignalsBlock.match(/style:\s*(.*)/i)?.[1]?.trim() ?? "";
    const termIdx = brandSignalsBlock.toLowerCase().indexOf("terminology:");
    const terminology =
      termIdx >= 0
        ? parseList(brandSignalsBlock.slice(termIdx + "terminology:".length))
        : [];
    brandSignals = { tone, style, recurringTerminology: terminology };
  }

  return {
    id,
    name: name || "Unknown",
    mission: mission || "",
    vision: subsection(body, "Vision") || undefined,
    brandVoice: brandVoice || "",
    values: parseList(subsection(body, "Values")),
    features: parseList(subsection(body, "Features")),
    benefits: parseList(subsection(body, "Benefits")),
    pricing: subsection(body, "Pricing") || undefined,
    industry: subsection(body, "Industry") || undefined,
    businessObjectives: parseList(subsection(body, "BusinessObjectives")),
    products: [],
    brandSignals,
  };
}

function parseProducts(body: string): Product[] {
  if (!body || body === "_empty_") return [];
  const productBlocks = body.split(/^## /m).slice(1);
  return productBlocks.map((block) => {
    const nameLine = block.split("\n")[0]?.trim() ?? "Unnamed";
    const rest = block.slice(nameLine.length).trim();
    return {
      id: h3(rest, "Id") || nameLine.toLowerCase().replace(/\s+/g, "-"),
      name: nameLine,
      features: parseList(h3(rest, "Features")),
      benefits: parseList(h3(rest, "Benefits")),
      pricing: h3(rest, "Pricing") || undefined,
      targetAudience: h3(rest, "TargetAudience") || undefined,
    };
  });
}

function parseAudiences(body: string): AudiencePersona[] {
  if (!body || body === "_empty_") return [];
  const blocks = body.split(/^## /m).slice(1);
  return blocks.map((block) => {
    const id = block.split("\n")[0]?.trim() ?? "persona";
    const rest = block.slice(id.length).trim();
    const sourceRaw = h3(rest, "Source");
    const source =
      sourceRaw === "user_created" || sourceRaw === "merged"
        ? sourceRaw
        : "ai_generated";
    return {
      id,
      icpDefinition: h3(rest, "ICPDefinition"),
      painPoints: parseList(h3(rest, "PainPoints")),
      jobsToBeDone: parseList(h3(rest, "JobsToBeDone")),
      objections: parseList(h3(rest, "Objections")),
      dreamOutcomes: parseList(h3(rest, "DreamOutcomes")),
      source,
      kbVersion: h3(rest, "KbVersion") || "v0",
      createdAt: h3(rest, "CreatedAt") || new Date(0).toISOString(),
    };
  });
}

function parseExperiments(body: string): Experiment[] {
  if (!body || body === "_empty_") return [];
  const blocks = body.split(/^## /m).slice(1);
  return blocks.map((block) => {
    const id = block.split("\n")[0]?.trim() ?? "experiment";
    const rest = block.slice(id.length).trim();
    const statusRaw = h3(rest, "Status");
    const status =
      statusRaw === "running" ||
      statusRaw === "completed" ||
      statusRaw === "inconclusive"
        ? statusRaw
        : "draft";
    return {
      id,
      hypothesisId: h3(rest, "Hypothesis"),
      postVariantIds: parseList(h3(rest, "PostVariantIDs")),
      publishedDates: parseList(h3(rest, "PublishedDates")),
      lessonsLearned: h3(rest, "LessonsLearned") || undefined,
      status,
      versionCounter: Number(h3(rest, "VersionCounter") || "0") || 0,
      createdAt: h3(rest, "CreatedAt") || new Date(0).toISOString(),
    };
  });
}

export interface ParseMarkdownResult {
  payload: KBPayload;
  sectionsPresent: Record<(typeof REQUIRED_SECTIONS)[number], boolean>;
  sectionsNonEmpty: Record<(typeof REQUIRED_SECTIONS)[number], boolean>;
}

/**
 * Parse Markdown back to typed objects and report section presence.
 * Populated entities require their section to be present and non-empty.
 */
export function parseFromMarkdown(markdown: string): ParseMarkdownResult {
  const sections = splitSections(markdown);
  const sectionsPresent = {
    Company_Identity: "Company_Identity" in sections,
    Products: "Products" in sections,
    Audiences: "Audiences" in sections,
    Experiments: "Experiments" in sections,
  } as const;

  const companyIdentity = sectionsPresent.Company_Identity
    ? parseCompanyIdentity(sections.Company_Identity)
    : undefined;
  const products = sectionsPresent.Products
    ? parseProducts(sections.Products)
    : [];
  const audiences = sectionsPresent.Audiences
    ? parseAudiences(sections.Audiences)
    : [];
  const experiments = sectionsPresent.Experiments
    ? parseExperiments(sections.Experiments)
    : [];

  // Attach products onto company identity when present
  if (companyIdentity && products.length > 0) {
    companyIdentity.products = products;
  }

  const sectionsNonEmpty = {
    Company_Identity: Boolean(
      companyIdentity &&
        (companyIdentity.name ||
          companyIdentity.mission ||
          companyIdentity.brandVoice),
    ),
    Products: products.length > 0,
    Audiences: audiences.length > 0,
    Experiments: experiments.length > 0,
  };

  return {
    payload: { companyIdentity, products, audiences, experiments },
    sectionsPresent: { ...sectionsPresent },
    sectionsNonEmpty,
  };
}

/**
 * Validate that all four top-level sections are present.
 * For each populated entity group, the corresponding section must be non-empty.
 */
export function validateMarkdownSections(
  markdown: string,
  expectPopulated?: {
    companyIdentity?: boolean;
    products?: boolean;
    audiences?: boolean;
    experiments?: boolean;
  },
): { valid: boolean; missing: string[] } {
  const { sectionsPresent, sectionsNonEmpty } = parseFromMarkdown(markdown);
  const missing: string[] = [];
  for (const s of REQUIRED_SECTIONS) {
    if (!sectionsPresent[s]) missing.push(s);
  }
  if (expectPopulated?.companyIdentity && !sectionsNonEmpty.Company_Identity) {
    missing.push("Company_Identity(empty)");
  }
  if (expectPopulated?.products && !sectionsNonEmpty.Products) {
    missing.push("Products(empty)");
  }
  if (expectPopulated?.audiences && !sectionsNonEmpty.Audiences) {
    missing.push("Audiences(empty)");
  }
  if (expectPopulated?.experiments && !sectionsNonEmpty.Experiments) {
    missing.push("Experiments(empty)");
  }
  return { valid: missing.length === 0, missing };
}

export { REQUIRED_SECTIONS };
