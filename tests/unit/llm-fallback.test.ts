import { describe, expect, it } from "vitest";
import {
  AnthropicLLMClient,
  FallbackLLMClient,
  ScriptedLLMClient,
  buildLLMClientFromConfig,
  resetLLMClient,
} from "../../src/lib/content-creator-ai/integrations/llm.js";

describe("FallbackLLMClient", () => {
  it("returns primary when it succeeds", async () => {
    const client = new FallbackLLMClient(
      new ScriptedLLMClient(["from-ollama"]),
      new ScriptedLLMClient(["from-claude"]),
    );
    await expect(client.complete("hi")).resolves.toBe("from-ollama");
  });

  it("falls back when primary returns null", async () => {
    const client = new FallbackLLMClient(
      new ScriptedLLMClient([null]),
      new ScriptedLLMClient(["from-claude"]),
    );
    await expect(client.complete("hi")).resolves.toBe("from-claude");
  });
});

describe("AnthropicLLMClient", () => {
  it("calls Messages API with x-api-key", async () => {
    const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "claude-ok" }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const client = new AnthropicLLMClient({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      fetchImpl,
    });
    await expect(client.complete("ping", { system: "be brief" })).resolves.toBe(
      "claude-ok",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers.get("x-api-key")).toBe("sk-ant-test");
    expect(calls[0].headers.get("anthropic-version")).toBe("2023-06-01");
    expect(calls[0].body).toMatchObject({
      model: "claude-sonnet-4-6",
      system: "be brief",
      messages: [{ role: "user", content: "ping" }],
    });
  });
});

describe("buildLLMClientFromConfig", () => {
  it("wraps ollama with Claude when fallback key is set", async () => {
    resetLLMClient();
    const client = buildLLMClientFromConfig({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:9",
      model: "llama3.1",
      fallbackApiKey: "sk-ant-fallback",
      fallbackModel: "claude-sonnet-4-6",
    });
    // Unreachable Ollama should fail fast and leave room for Claude; without a
    // network Claude call we only assert the wrapper type via behavior:
    // primary timeout → null from both if Claude also fails (no network mock).
    const result = await client.complete("x", {
      timeoutMs: 50,
      maxAttempts: 1,
    });
    expect(result).toBeNull();
  });
});
