# Liquid Copy UI

Vite + React operator frontend for liquid_copy.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

- `/` — brand landing
- `/app` — operator workspace (overview, checkpoints, experiments, knowledge, platforms)

Uses an in-memory demo store by default. Set `VITE_API_BASE_URL` to point at a live Next server serving `/api/content-creator-ai/*`.
