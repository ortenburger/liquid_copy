import type { KBDocument, RAGPassage } from "../types/index.js";
import type { RetrievalScope } from "../types/enums.js";

export interface SemanticSearchOptions {
  query: string;
  scope?: RetrievalScope;
  k?: number;
}

export interface VectorStoreAdapter {
  indexDocuments(docs: KBDocument[]): Promise<void>;
  semanticSearch(options: SemanticSearchOptions): Promise<RAGPassage[]>;
  clear(): Promise<void>;
  size(): number;
}

interface IndexedEntry {
  doc: KBDocument;
  embedding: number[];
}

const DEFAULT_K = 5;
const EMBEDDING_DIM = 64;

/**
 * Deterministic bag-of-tokens embedding used when Ollama is unavailable
 * (tests / offline). Produces stable vectors for cosine similarity.
 */
export function localHashEmbed(text: string, dim = EMBEDDING_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return vec;
  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    vec[idx] += 1;
  }
  // L2 normalise
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

async function ollamaEmbed(text: string): Promise<number[] | null> {
  const base =
    process.env.LLM_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:11434";
  const model = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
  try {
    const res = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: number[] };
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

async function embed(text: string): Promise<number[]> {
  if (process.env.RAG_FORCE_LOCAL_EMBED === "1") {
    return localHashEmbed(text);
  }
  const remote = await ollamaEmbed(text);
  return remote ?? localHashEmbed(text);
}

/**
 * In-memory cosine-similarity vector store (default local-first backend).
 * Used when RAG_BACKEND is unset or set to `hnswlib` without the native addon.
 * Returns `[]` (never throws) on unavailability or zero results.
 */
export class InMemoryVectorStore implements VectorStoreAdapter {
  private entries: IndexedEntry[] = [];
  private available = true;

  markUnavailable(): void {
    this.available = false;
  }

  markAvailable(): void {
    this.available = true;
  }

  async indexDocuments(docs: KBDocument[]): Promise<void> {
    if (!this.available) return;
    for (const doc of docs) {
      const embedding = await embed(doc.content);
      // Replace existing doc with same id
      this.entries = this.entries.filter((e) => e.doc.id !== doc.id);
      this.entries.push({ doc, embedding });
    }
  }

  async semanticSearch(
    options: SemanticSearchOptions,
  ): Promise<RAGPassage[]> {
    try {
      if (!this.available) return [];
      const k = options.k ?? DEFAULT_K;
      let candidates = this.entries;
      if (options.scope) {
        candidates = candidates.filter((e) => e.doc.scope === options.scope);
      }
      if (candidates.length === 0) return [];

      const queryEmbedding = await embed(options.query);
      const scored = candidates
        .map((e) => ({
          entry: e,
          score: cosine(queryEmbedding, e.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, k));

      return scored.map(({ entry, score }) => ({
        content: entry.doc.content,
        sourceDoc: entry.doc.id,
        similarityScore: score,
        scope: entry.doc.scope,
      }));
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }

  /** Expose indexed contents for property tests (substring checks). */
  getIndexedContents(): string[] {
    return this.entries.map((e) => e.doc.content);
  }
}

let activeStore: VectorStoreAdapter = new InMemoryVectorStore();

/**
 * Resolve the active vector store based on RAG_BACKEND.
 * Defaults to in-memory hnswlib-compatible store; ChromaDB can be wired later.
 */
export function getVectorStore(): VectorStoreAdapter {
  const backend = (process.env.RAG_BACKEND ?? "hnswlib").toLowerCase();
  if (backend === "chromadb") {
    // ChromaDB adapter placeholder — fall back to in-memory until wired.
    return activeStore;
  }
  return activeStore;
}

/** Replace the active store (tests). */
export function setVectorStore(store: VectorStoreAdapter): void {
  activeStore = store;
}

/** Reset to a fresh in-memory store (tests). */
export function resetVectorStore(): InMemoryVectorStore {
  const store = new InMemoryVectorStore();
  activeStore = store;
  return store;
}

export async function indexDocuments(docs: KBDocument[]): Promise<void> {
  try {
    await getVectorStore().indexDocuments(docs);
  } catch {
    // Unavailable — swallow per contract (return [] on search)
  }
}

export async function semanticSearch(
  options: SemanticSearchOptions,
): Promise<RAGPassage[]> {
  try {
    return await getVectorStore().semanticSearch(options);
  } catch {
    return [];
  }
}

/**
 * Select passages for a generation prompt: exactly min(available, 5).
 * Property 29 / Requirements 14.2, 14.6.
 */
export function selectPassagesForPrompt(
  passages: RAGPassage[],
  max = 5,
): { passages: RAGPassage[]; generatedWithoutRetrievedContext: boolean } {
  const selected = passages.slice(0, max);
  return {
    passages: selected,
    generatedWithoutRetrievedContext: selected.length === 0,
  };
}
