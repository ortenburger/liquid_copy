# Liquid Copy UI

Vite + React operator frontend for liquid_copy.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

- `/` — brand landing
- `/app` — operator workspace (overview, checkpoints, experiments, knowledge, platforms, carousels, settings)

**Settings** (`/app/settings`): simulation ↔ real data toggle, Firecrawl API key, LLM providers (Ollama / OpenAI / Claude), Open Carrusel URL. The studio is embedded at **`/app/carousels`**. Keys stay in `localStorage`.
