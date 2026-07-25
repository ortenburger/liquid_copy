# Liquid Copy UI

Vite + React operator frontend for liquid_copy.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

- `/` — brand landing
- `/app` — operator workspace (overview, checkpoints, experiments, knowledge, platforms, settings)

Uses an in-memory demo store by default for workflow UI. Configure Ollama / OpenAI / Claude under **Settings** (`/app/settings`); keys stay in `localStorage`. Set `VITE_API_BASE_URL` to point at a live Next server serving `/api/content-creator-ai/*` when you want the UI to drive real agents.
