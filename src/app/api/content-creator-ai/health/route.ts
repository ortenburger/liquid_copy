import { jsonResponse } from "@/lib/content-creator-ai/api/runtime.js";

/** GET /api/content-creator-ai/health */
export async function GET(): Promise<Response> {
  return jsonResponse({
    ok: true,
    service: "liquid-copy-api",
    time: new Date().toISOString(),
  });
}
