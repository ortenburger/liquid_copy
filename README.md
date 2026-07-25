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
├── src/lib/content-creator-ai/   # Shared platform library + agents
│   ├── types/
│   ├── kb/
│   ├── rag/
│   ├── orchestration/
│   ├── agents/
│   ├── integrations/
│   ├── publishing/
│   └── api/
├── src/app/api/content-creator-ai/  # Next-shaped API route handlers
├── web/                          # Vite operator UI (landing + workspace)
├── tests/pbt/                    # Property-based tests (fast-check + Vitest)
├── open-carrusel/                # Carousel generation UI + API
├── design.md                     # Liquid Copy design system
├── .kiro/specs/content-creator-ai/
├── tasklist_1.md                 # Shared foundation (done)
├── tasklist_2.md                 # Ingestion, strategy, audience, workflow, API (done)
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

# Operator UI (Vite)
cd web && npm install && cd ..

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
| `VITE_API_BASE_URL` | `http://localhost:8787` | Default Liquid Copy API origin for the Vite UI |
| `PORT` / `API_PORT` | `8787` | Local API listen port (`npm run api:dev`) |
| `FIRECRAWL_API_KEY` | unset | Context Agent + brand fill (also syncable from Settings) |
| `LLM_BASE_URL` | unset | When set, enables Ollama (or compatible) for agents |

---

## Scripts

```bash
npm test          # Run Vitest (including property-based tests)
npm run test:watch
npm run typecheck

npm run api:dev       # Liquid Copy agent API → http://localhost:8787
npm run web:dev       # Operator UI → http://localhost:5173
npm run carousel:dev  # Open Carrusel → http://localhost:3000
npm run dev:stack     # All three together

# Open Carrusel alone
cd open-carrusel
npm run setup     # First-time setup
npm run doctor    # Environment check
npm run dev       # http://localhost:3000
```

### Real-data mode

1. `npm run api:dev` (or `npm run dev:stack`)
2. Open http://localhost:5173 → **Settings**
3. Toggle **Use real data**, confirm API URL `http://localhost:8787`, **Ping API**
4. Save Firecrawl / LLM / Zernio settings (synced to the API process)

Simulation mode (default) keeps using in-browser fixtures and does not need the API.

---

## How to test (Simple UI end-to-end)

Use this path to go from a website scrape to carousels posted in Zernio.

### 1. Start the stack

```bash
npm run dev:stack
```

- UI: http://localhost:5173  
- API: http://localhost:8787  
- Open Carrusel: http://localhost:3000  

### 2. Configure Settings

Open **Settings** and:

1. Turn on **Simple UI**
2. Turn on **Use real data**
3. Add your **Firecrawl** API key
4. Add your **Zernio** API key (base URL `https://zernio.com/api/v1`; optional account ID / platform)
5. Install [Ollama](https://ollama.com) locally **or** set an API key for your LLM provider (OpenAI / Anthropic / compatible), then pick model + base URL
6. Confirm Open Carrusel base URL is `http://localhost:3000`
7. **Save** (and **Ping API** if you want a quick health check)

For Ollama, a typical setup is:

```bash
ollama pull llama3.1
# optional embeddings for RAG
ollama pull nomic-embed-text
```

### 3. Chat — scrape your website into RAG

1. Go to **Chat**
2. Ask the agent to scrape your website and fill in relevant business data, e.g.  
   `Ingest https://your-company.com and save the company profile to the knowledge base / RAG.`
3. Wait until the agent confirms the data was saved to RAG / the knowledge base

### 4. Plan — generate the testing plan

1. Go to **Plan**
2. Click **Generate plan**
3. Wait for:
   - 7 hypotheses grounded in RAG/KB (via your LLM)
   - One carousel per hypothesis for the next 7 days

### 5. Queue all to Zernio

1. Still on **Plan**, click **Queue all to Zernio**
2. Open [Zernio](https://zernio.com) → **Posts**
3. You should see the carousels posted (or saved as drafts if no social account is connected)

---

## Automated tests

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
| **Task list 2** | Context / Strategy / Audience agents, workflow, API | Done |
| **Task list 3** | Content / Analytics / Learning agents, publishing | Done |

---

## License

Hackathon project — see individual package licenses (`open-carrusel` is MIT).
