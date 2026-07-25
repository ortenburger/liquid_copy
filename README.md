# liquid_copy

**Cursor Hackathon 2026 — Stuttgart**

AI-powered social content experimentation platform. It builds persistent company knowledge, runs hypothesis-driven content experiments across social platforms, generates carousels via Open Carrusel, and feeds performance learnings back into the knowledge base.

Rather than one-off post generation, the system is a continuous loop: **context → strategy → content → publish → analytics → learn**.

---

## What it does

| Capability | Description |
|---|---|
| **Context ingestion** | Scrapes company/product info (Firecrawl) or guided Q&A; merges into a versioned Knowledge Base |
| **Strategy** | Marketing goals, multi-week experimentation roadmaps, structured hypotheses |
| **Audience** | ICP personas with overlap detection and merge |
| **Content** | Platform-specific post variants via [Open Carrusel](./open-carrusel) |
| **Analytics** | Zernio metrics, A/B significance, winner identification |
| **Learning** | Winning/failed patterns written back to the KB as immutable versions |
| **Modes** | Full Auto or Human-in-the-Loop with configurable approval checkpoints |

Specs live under [`.kiro/specs/content-creator-ai/`](.kiro/specs/content-creator-ai/) (`requirements.md`, `design.md`).

---

## Architecture

Six agents coordinate through a shared **Event Bus**, grounded by a Markdown **Knowledge Base** and **RAG** layer:

```
Firecrawl / Q&A  →  Context Agent  →  KB (Markdown + versions)  →  RAG
                         ↓
              Strategy / Audience / Content Agents
                         ↓
              Open Carrusel  →  Social platforms
                         ↓
              Zernio  →  Analytics Agent  →  Learning Agent  →  KB
                         ↑
                   Event Bus + Workflow Engine (HITL / Full Auto)
```

### Shared foundation (`src/lib/content-creator-ai/`)

Built first so parallel agents can import stable contracts:

| Module | Role |
|---|---|
| `types/` | Core TypeScript interfaces & enums |
| `kb/` | Write-once versioned Markdown storage, serialiser, user-precedence merge |
| `rag/` | Local embeddings (Ollama `nomic-embed-text`) + vector search; reindex on `kb.updated` |
| `orchestration/` | Typed Event Bus with optional acknowledgement timeouts |

Vendored carousel app: [`open-carrusel/`](./open-carrusel) (Next.js, local Claude-driven slide generation & PNG export).

---

## Project structure

```
liquid_copy/
├── src/lib/content-creator-ai/   # Shared platform library
│   ├── types/
│   ├── kb/
│   ├── rag/
│   ├── orchestration/
│   ├── agents/                   # Agent implementations (in progress)
│   ├── integrations/
│   ├── publishing/
│   └── api/
├── tests/pbt/                    # Property-based tests (fast-check + Vitest)
├── open-carrusel/                # Carousel generation UI + API
├── .kiro/specs/content-creator-ai/
├── tasklist_1.md                 # Shared foundation (done)
├── tasklist_2.md                 # Ingestion, strategy, audience, workflow, API
└── tasklist_3.md                 # Content, publishing, analytics, learning (done)
```

---

## Prerequisites

- **Node.js** ≥ 20
- **npm**
- Optional for RAG embeddings: [Ollama](https://ollama.com) with `nomic-embed-text`
- Optional for Open Carrusel: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI authenticated locally

---

## Setup

```bash
# Platform library
npm install

# Open Carrusel (carousel generator)
cd open-carrusel && npm install && cd ..
```

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `KB_STORAGE_PATH` | `.kb-storage/` | Knowledge Base filesystem root |
| `RAG_BACKEND` | `hnswlib` | Vector store (`hnswlib` or `chromadb`) |
| `LLM_BASE_URL` | `http://127.0.0.1:11434` | Ollama-compatible embeddings endpoint |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |
| `RAG_FORCE_LOCAL_EMBED` | unset | Set `1` to use deterministic local embeddings (tests / offline) |

---

## Scripts

```bash
npm test          # Run Vitest (including property-based tests)
npm run test:watch
npm run typecheck

# Open Carrusel
cd open-carrusel
npm run setup     # First-time setup
npm run doctor    # Environment check
npm run dev       # http://localhost:3000
```

---

## Testing

Property-based tests (fast-check, ≥100 runs where specified) live in `tests/pbt/`.

Foundation checkpoint:

```bash
npx vitest --run tests/pbt/kb-merge.pbt.test.ts tests/pbt/rag-retrieval.pbt.test.ts
```

Each property test is tagged: `// Feature: content-creator-ai, Property N: …`

---

## Importing the shared library

```typescript
import type { CompanyIdentity, Hypothesis } from "@/lib/content-creator-ai/types";
import { writeKBEntity, readKBEntity } from "@/lib/content-creator-ai/kb/storage";
import { semanticSearch, selectPassagesForPrompt } from "@/lib/content-creator-ai/rag/vectorstore";
import { eventBus } from "@/lib/content-creator-ai/orchestration/event-bus";
```

---

## Development status

| Track | Scope | Status |
|---|---|---|
| **Task list 1** | Types, KB, RAG, Event Bus | Done |
| **Task list 2** | Context / Strategy / Audience agents, workflow, API | In progress |
| **Task list 3** | Content / Analytics / Learning agents, publishing | Done |

---

## License

Hackathon project — see individual package licenses (`open-carrusel` is MIT).
