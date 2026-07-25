/**
 * Local Liquid Copy API server.
 *
 * Mounts the Next-shaped route handlers under `/api/content-creator-ai/*`
 * so the Vite UI can flip Settings → Use real data and talk to a real process.
 *
 *   npm run api:dev   → http://localhost:8787
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { GET as healthGet } from "@/app/api/content-creator-ai/health/route.js";
import { POST as configPost } from "@/app/api/content-creator-ai/config/route.js";
import { POST as ingestPost } from "@/app/api/content-creator-ai/ingest/route.js";
import { GET as eventsGet } from "@/app/api/content-creator-ai/events/route.js";
import {
  GET as kbGet,
  PUT as kbPut,
} from "@/app/api/content-creator-ai/knowledge-base/route.js";
import {
  GET as platformsGet,
  POST as platformsPost,
} from "@/app/api/content-creator-ai/platform-selection/route.js";
import {
  GET as workflowStatusGet,
  PUT as workflowModePut,
} from "@/app/api/content-creator-ai/workflow/status/route.js";
import { POST as workflowRunPost } from "@/app/api/content-creator-ai/workflow/run/route.js";
import { POST as checkpointPost } from "@/app/api/content-creator-ai/checkpoints/[stage]/[action]/route.js";
import { POST as searchPost } from "@/app/api/content-creator-ai/search/route.js";
import { GET as traceabilityGet } from "@/app/api/content-creator-ai/traceability/[variantId]/route.js";
import { applyRequestSecrets } from "@/lib/content-creator-ai/api/runtime.js";
import {
  reindexAllKBEntities,
  startRAGReindexListener,
} from "@/lib/content-creator-ai/rag/reindex.js";

const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

type Handler = (
  request: Request,
  context?: { params: Record<string, string> | Promise<Record<string, string>> },
) => Promise<Response> | Response;

type ParamHandler = (
  request: Request,
  context: { params: Record<string, string> | Promise<Record<string, string>> },
) => Promise<Response> | Response;

interface Route {
  method: string;
  match: (pathname: string) => { params: Record<string, string> } | null;
  handler: Handler;
}

function exact(method: string, path: string, handler: Handler): Route {
  return {
    method,
    match: (pathname) => (pathname === path ? { params: {} } : null),
    handler,
  };
}

function pattern(
  method: string,
  template: string,
  handler: ParamHandler,
): Route {
  const parts = template.split("/").filter(Boolean);
  return {
    method,
    match: (pathname) => {
      const segs = pathname.split("/").filter(Boolean);
      if (segs.length !== parts.length) return null;
      const params: Record<string, string> = {};
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const seg = segs[i];
        if (part.startsWith("[") && part.endsWith("]")) {
          params[part.slice(1, -1)] = decodeURIComponent(seg);
        } else if (part !== seg) {
          return null;
        }
      }
      return { params };
    },
    handler: (request, context) =>
      handler(request, { params: context?.params ?? {} }),
  };
}

const routes: Route[] = [
  exact("GET", "/api/content-creator-ai/health", healthGet),
  exact("POST", "/api/content-creator-ai/config", configPost),
  exact("POST", "/api/content-creator-ai/ingest", ingestPost),
  exact("GET", "/api/content-creator-ai/events", eventsGet),
  exact("GET", "/api/content-creator-ai/knowledge-base", kbGet),
  exact("PUT", "/api/content-creator-ai/knowledge-base", kbPut),
  exact("GET", "/api/content-creator-ai/platform-selection", platformsGet),
  exact("POST", "/api/content-creator-ai/platform-selection", platformsPost),
  exact("GET", "/api/content-creator-ai/workflow/status", workflowStatusGet),
  exact("PUT", "/api/content-creator-ai/workflow/status", workflowModePut),
  exact("POST", "/api/content-creator-ai/workflow/run", workflowRunPost),
  exact("POST", "/api/content-creator-ai/search", searchPost),
  pattern(
    "POST",
    "/api/content-creator-ai/checkpoints/[stage]/[action]",
    checkpointPost as ParamHandler,
  ),
  pattern(
    "GET",
    "/api/content-creator-ai/traceability/[variantId]",
    traceabilityGet as ParamHandler,
  ),
];

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Firecrawl-Api-Key, X-Zernio-Api-Key, X-Zernio-Api-Base, X-LLM-Base-Url, X-LLM-Model, X-LLM-Api-Key, X-LLM-Provider, X-LLM-Fallback-Api-Key, X-LLM-Fallback-Model",
  "Access-Control-Expose-Headers": "Content-Type",
};

async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return undefined;
  // Do NOT use Buffer.concat(...).buffer — pooled ArrayBuffers have a non-zero
  // byteOffset and would corrupt JSON.parse in Request.json().
  return Uint8Array.from(Buffer.concat(chunks));
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? `${HOST}:${PORT}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const method = (req.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const body = await readBody(req);
    if (body && body.byteLength > 0) {
      init.body = body;
    }
  }
  return new Request(url, init);
}

async function writeWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  const headers: Record<string, string> = { ...CORS_HEADERS };
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch {
    res.end();
  }
}

function findRoute(
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const matched = route.match(pathname);
    if (matched) return { route, params: matched.params };
  }
  return null;
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const method = (req.method ?? "GET").toUpperCase();
      if (method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const host = req.headers.host ?? `${HOST}:${PORT}`;
      const url = new URL(req.url ?? "/", `http://${host}`);
      const matched = findRoute(method, url.pathname);
      if (!matched) {
        res.writeHead(404, {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: `No route for ${method} ${url.pathname}`,
            hint: "Try GET /api/content-creator-ai/health",
          }),
        );
        return;
      }

      const request = await toWebRequest(req);
      applyRequestSecrets(request.headers);

      const response = await matched.route.handler(request, {
        params: matched.params,
      });
      await writeWebResponse(res, response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[liquid-copy-api]", message);
      if (!res.headersSent) {
        res.writeHead(500, {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        });
      }
      res.end(JSON.stringify({ error: message }));
    }
  })();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[liquid-copy-api] port ${PORT} is already in use. Set PORT=… or free the port.`,
    );
  } else {
    console.error("[liquid-copy-api]", err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(
    `[liquid-copy-api] listening on http://${HOST}:${PORT}`,
  );
  console.log(
    `[liquid-copy-api] health → http://${HOST}:${PORT}/api/content-creator-ai/health`,
  );
  if (!process.env.FIRECRAWL_API_KEY) {
    console.log(
      "[liquid-copy-api] FIRECRAWL_API_KEY unset — UI can still send X-Firecrawl-Api-Key",
    );
  }
  if (!process.env.LLM_BASE_URL) {
    console.log(
      "[liquid-copy-api] LLM_BASE_URL unset — heuristics until Settings syncs LLM config",
    );
  }

  startRAGReindexListener({ delayMs: 0 });
  void reindexAllKBEntities()
    .then((n) => {
      console.log(`[liquid-copy-api] RAG indexed ${n} KB document(s)`);
    })
    .catch((err) => {
      console.warn(
        "[liquid-copy-api] RAG startup reindex failed:",
        err instanceof Error ? err.message : err,
      );
    });
});
