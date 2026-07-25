/**
 * Shared RAG grounding helper — Requirements 14.1, 14.2, 14.6.
 *
 * Every agent queries the RAG layer before generating, incorporates exactly
 * min(available, 5) passages (Property 29), and tags its output when nothing
 * came back. Centralised so the passage cap and the tag string cannot drift
 * between agents.
 */
import type { RAGPassage } from "../../types/index.js";
import type { RetrievalScope } from "../../types/enums.js";
import {
  semanticSearch,
  selectPassagesForPrompt,
} from "../../rag/vectorstore.js";

/** Applied when RAG returns nothing or is unavailable (Requirement 14.6). */
export const NO_RETRIEVED_CONTEXT_TAG = "generated without retrieved context";

/** Passages incorporated into a generation prompt (Requirement 14.2). */
export const MAX_GROUNDING_PASSAGES = 5;

export interface GroundingResult {
  passages: RAGPassage[];
  /** Set only when zero passages were available. */
  contextTag?: typeof NO_RETRIEVED_CONTEXT_TAG;
  /** Whether generation is proceeding ungrounded. */
  generatedWithoutRetrievedContext: boolean;
  /** Ready-to-embed prompt fragment; empty string when ungrounded. */
  promptBlock: string;
}

export interface RetrieveGroundingOptions {
  query: string;
  scope?: RetrievalScope;
  k?: number;
}

/**
 * Query RAG and shape the result for a generation prompt. Never throws: an
 * unavailable index yields zero passages and the "without retrieved context" tag.
 */
export async function retrieveGrounding(
  options: RetrieveGroundingOptions,
): Promise<GroundingResult> {
  const k = options.k ?? MAX_GROUNDING_PASSAGES;
  let raw: RAGPassage[] = [];
  try {
    raw = await semanticSearch({
      query: options.query,
      scope: options.scope,
      k,
    });
  } catch {
    // RAG layer contract is to return [], but stay defensive here.
    raw = [];
  }

  const { passages, generatedWithoutRetrievedContext } =
    selectPassagesForPrompt(raw, Math.min(k, MAX_GROUNDING_PASSAGES));

  return {
    passages,
    contextTag: generatedWithoutRetrievedContext
      ? NO_RETRIEVED_CONTEXT_TAG
      : undefined,
    generatedWithoutRetrievedContext,
    promptBlock: formatPassages(passages),
  };
}

/** Render passages as a numbered context block for a prompt. */
export function formatPassages(passages: RAGPassage[]): string {
  if (passages.length === 0) return "";
  return passages
    .map(
      (p, i) =>
        `[${i + 1}] (${p.scope}, similarity ${p.similarityScore.toFixed(3)})\n${p.content}`,
    )
    .join("\n\n");
}
