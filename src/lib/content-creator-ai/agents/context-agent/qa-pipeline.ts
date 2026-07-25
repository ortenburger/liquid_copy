/**
 * Guided Q&A pipeline — the Firecrawl fallback path (Task 5.2, Requirement 1.4).
 *
 * A stateful finite conversation chain of at most 10 prompts covering the fields
 * named in the design: company name → industry → mission → products → brand
 * voice → values → target outcome (with vision, features and benefits filling
 * out the 10). The local LLM is used only to phrase questions and to split
 * free-text list answers; every step has a deterministic fallback so the
 * pipeline works with no model running.
 */
import type { CompanyIdentity, Product } from "../../types/index.js";
import { getLLMClient, type LLMClient } from "../../integrations/llm.js";

export const MAX_QA_PROMPTS = 10;

/** Which CompanyIdentity field a step populates. */
export type QAFieldKey =
  | "name"
  | "industry"
  | "mission"
  | "vision"
  | "products"
  | "brandVoice"
  | "values"
  | "features"
  | "benefits"
  | "targetOutcome";

export interface QAStep {
  key: QAFieldKey;
  /** Default wording, used when the LLM is unavailable. */
  prompt: string;
  /** List answers are split into arrays; scalar answers are kept verbatim. */
  kind: "scalar" | "list";
  /** A blank answer is accepted and backfilled by `build()`. */
  optional: boolean;
}

/** The canonical 10-step chain, in the order the design specifies. */
export const QA_STEPS: readonly QAStep[] = [
  { key: "name", prompt: "What is your company's name?", kind: "scalar", optional: false },
  { key: "industry", prompt: "Which industry do you operate in?", kind: "scalar", optional: false },
  { key: "mission", prompt: "What is your company's mission?", kind: "scalar", optional: false },
  { key: "vision", prompt: "What is your longer-term vision?", kind: "scalar", optional: true },
  { key: "products", prompt: "Which products or services do you offer? List them separated by commas.", kind: "list", optional: false },
  { key: "brandVoice", prompt: "How would you describe your brand voice and tone?", kind: "scalar", optional: false },
  { key: "values", prompt: "What values guide your company? List them separated by commas.", kind: "list", optional: true },
  { key: "features", prompt: "What are the standout features of your offering?", kind: "list", optional: true },
  { key: "benefits", prompt: "What benefits do customers get? List them separated by commas.", kind: "list", optional: true },
  { key: "targetOutcome", prompt: "What business outcome do you want this content to drive?", kind: "list", optional: false },
] as const;

export interface QAQuestion {
  key: QAFieldKey;
  prompt: string;
  /** 1-indexed. */
  step: number;
  totalSteps: number;
  optional: boolean;
}

export interface QASubmitResult {
  accepted: boolean;
  /** Present when the answer was rejected (a required field left blank). */
  error?: string;
  next: QAQuestion | null;
  complete: boolean;
}

/**
 * Split a free-text list answer without needing a model.
 *
 * Splitting and marker-stripping are separate passes on purpose: folding the
 * bullet pattern into the split regex means the newline alternative consumes the
 * whitespace a following `- ` marker needs, leaving every bullet after the first
 * un-stripped.
 */
export function splitListAnswer(answer: string): string[] {
  return answer
    .split(/[\n;,]/)
    .map((part) => part.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((part) => part.length > 0);
}

export interface QAPipelineOptions {
  llm?: LLMClient;
  /** Company id for the produced identity. Defaults to a slug of the name. */
  entityId?: string;
}

/**
 * Stateful Q&A chain. Drive it with `currentQuestion()` / `submitAnswer()`
 * until `isComplete()`, then call `build()`.
 */
export class QAPipeline {
  private readonly answers = new Map<QAFieldKey, string>();
  private index = 0;
  private readonly llm: LLMClient;
  private readonly entityId?: string;

  constructor(options: QAPipelineOptions = {}) {
    this.llm = options.llm ?? getLLMClient();
    this.entityId = options.entityId;
  }

  get totalSteps(): number {
    return Math.min(QA_STEPS.length, MAX_QA_PROMPTS);
  }

  currentQuestion(): QAQuestion | null {
    if (this.index >= this.totalSteps) return null;
    const step = QA_STEPS[this.index];
    return {
      key: step.key,
      prompt: step.prompt,
      step: this.index + 1,
      totalSteps: this.totalSteps,
      optional: step.optional,
    };
  }

  /**
   * Ask the model to phrase the next question more naturally. Falls back to the
   * canonical wording; the returned `key`/`step` are never model-controlled.
   */
  async currentQuestionPhrased(): Promise<QAQuestion | null> {
    const question = this.currentQuestion();
    if (!question) return null;
    const known = [...this.answers.entries()]
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const raw = await this.llm.complete(
      `You are onboarding a new marketing customer. Ask exactly one short, friendly question to learn their "${question.key}".\n` +
        (known ? `Already known:\n${known}\n` : "") +
        `Reply with the question only, no preamble.`,
    );
    const phrased = raw?.trim().split("\n")[0]?.trim();
    return phrased ? { ...question, prompt: phrased } : question;
  }

  submitAnswer(answer: string): QASubmitResult {
    const step = QA_STEPS[this.index];
    if (!step) {
      return { accepted: false, error: "Q&A pipeline already complete", next: null, complete: true };
    }

    const trimmed = answer.trim();
    if (!trimmed && !step.optional) {
      // Required field: re-ask rather than advancing with a hole.
      return {
        accepted: false,
        error: `${step.key} is required`,
        next: this.currentQuestion(),
        complete: false,
      };
    }

    this.answers.set(step.key, trimmed);
    this.index += 1;
    return {
      accepted: true,
      next: this.currentQuestion(),
      complete: this.isComplete(),
    };
  }

  isComplete(): boolean {
    return this.index >= this.totalSteps;
  }

  answeredCount(): number {
    return this.index;
  }

  getAnswer(key: QAFieldKey): string | undefined {
    return this.answers.get(key);
  }

  /**
   * Assemble a complete CompanyIdentity. Every required field is guaranteed
   * non-empty — optional questions left blank are backfilled from what is known
   * so downstream consumers (and Property 2) always see a usable summary.
   */
  build(): CompanyIdentity {
    const name = this.answers.get("name")?.trim() || "Unnamed Company";
    const industry = this.answers.get("industry")?.trim() || undefined;
    const mission =
      this.answers.get("mission")?.trim() ||
      `Serve ${industry ?? "our"} customers with ${name}`;
    const brandVoice =
      this.answers.get("brandVoice")?.trim() || "clear, helpful, professional";

    const productNames = splitListAnswer(this.answers.get("products") ?? "");
    const features = splitListAnswer(this.answers.get("features") ?? "");
    const benefits = splitListAnswer(this.answers.get("benefits") ?? "");
    const values = splitListAnswer(this.answers.get("values") ?? "");
    const objectives = splitListAnswer(this.answers.get("targetOutcome") ?? "");

    const products: Product[] = (
      productNames.length > 0 ? productNames : [`${name} core offering`]
    ).map((productName, i) => ({
      id: `${slug(name)}-product-${i + 1}`,
      name: productName,
      features,
      benefits,
      targetAudience: industry,
    }));

    return {
      id: this.entityId ?? slug(name),
      name,
      industry,
      mission,
      vision: this.answers.get("vision")?.trim() || undefined,
      brandVoice,
      values: values.length > 0 ? values : ["customer focus"],
      products,
      features,
      benefits,
      businessObjectives:
        objectives.length > 0 ? objectives : ["grow audience engagement"],
      brandSignals: {
        tone: brandVoice,
        style: "concise",
        recurringTerminology: dedupe([
          ...productNames,
          ...values,
        ]).slice(0, 10),
      },
      createdAt: new Date().toISOString(),
    };
  }
}

function slug(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "company";
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim().length > 0))];
}
