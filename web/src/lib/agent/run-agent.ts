import { ToolLoopAgent, generateText, stepCountIs } from "ai";
import type { LLMSettings } from "../settings";
import type { RAGPassage } from "../types";
import { createModelFromSettings, ollamaProviderOptions } from "./model";
import {
  createLiquidCopyTools,
  type LiquidCopyToolDeps,
} from "./tools";
import type {
  AgentToolEvent,
  ChatMessage,
  RagMarkdownSource,
} from "./types";

export interface RunLiquidCopyAgentInput {
  llm: LLMSettings;
  history: ChatMessage[];
  passages: RAGPassage[];
  markdownSources: RagMarkdownSource[];
  deps: LiquidCopyToolDeps;
}

export interface RunLiquidCopyAgentResult {
  reply: string;
  tools: AgentToolEvent[];
}

type ToolMap = ReturnType<typeof createLiquidCopyTools>;

function formatContext(
  passages: RAGPassage[],
  markdownSources: RagMarkdownSource[],
): string {
  const passageBlock =
    passages.length === 0
      ? "(none)"
      : passages
          .map(
            (p, i) =>
              `[${i + 1}] ${p.scope} · ${p.sourceDoc} (${(p.similarityScore * 100).toFixed(0)}%)\n${p.content}`,
          )
          .join("\n\n");

  const markdownBlock =
    markdownSources.length === 0
      ? "(none)"
      : markdownSources
          .map(
            (m) =>
              `--- FILE: ${m.entityId}.md (${m.entityType ?? "unknown"}) ---\n${m.markdown}`,
          )
          .join("\n\n");

  return `Retrieved RAG passages:\n${passageBlock}\n\nKB markdown already loaded:\n${markdownBlock}`;
}

function toModelMessages(history: ChatMessage[]) {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-24)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
}

function collectToolEvents(
  steps: Array<{
    toolResults?: ReadonlyArray<{
      toolName: string;
      input?: unknown;
      output?: unknown;
    }>;
  }>,
): AgentToolEvent[] {
  const events: AgentToolEvent[] = [];
  for (const step of steps) {
    for (const tr of step.toolResults ?? []) {
      events.push({
        name: tr.toolName,
        input:
          tr.input === undefined
            ? undefined
            : typeof tr.input === "string"
              ? tr.input
              : JSON.stringify(tr.input),
        output:
          typeof tr.output === "string"
            ? tr.output
            : JSON.stringify(tr.output, null, 2),
      });
    }
  }
  return events;
}

/** True when the model narrated a tool call instead of using native tools / answering. */
export function looksLikeToolNarration(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/```(?:json)?\s*\{\s*"name"\s*:/i.test(t)) return true;
  if (/^\s*\{\s*"name"\s*:\s*"[a-z0-9_]+"/i.test(t)) return true;
  if (/"parameters"\s*:\s*\{/.test(t) && /"name"\s*:/.test(t)) return true;
  if (/I will call (the )?(`?\w+`?|function)/i.test(t)) return true;
  if (/call the [`']?\w+_?\w*[`']? (function|tool)/i.test(t)) return true;
  if (/To answer (this|your) question, I will call/i.test(t)) return true;
  return false;
}

interface ParsedFauxCall {
  name: string;
  args: Record<string, unknown>;
}

/** Extract faux tool calls from model text (Ollama often prints these). */
export function parseFauxToolCalls(text: string): ParsedFauxCall[] {
  const found: ParsedFauxCall[] = [];
  const re =
    /\{\s*"name"\s*:\s*"([a-z0-9_]+)"\s*,\s*"parameters"\s*:\s*(\{[\s\S]*?\})\s*\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const args = JSON.parse(m[2]!) as Record<string, unknown>;
      found.push({ name: m[1]!, args });
    } catch {
      /* skip bad json */
    }
  }
  // Also: {"name":"search_rag","parameters":{...}} with nested braces via brace scan
  if (found.length === 0) {
    const idx = text.indexOf('"name"');
    if (idx >= 0) {
      const start = text.lastIndexOf("{", idx);
      if (start >= 0) {
        let depth = 0;
        for (let i = start; i < text.length; i++) {
          if (text[i] === "{") depth++;
          else if (text[i] === "}") {
            depth--;
            if (depth === 0) {
              try {
                const obj = JSON.parse(text.slice(start, i + 1)) as {
                  name?: string;
                  parameters?: Record<string, unknown>;
                  arguments?: Record<string, unknown>;
                };
                if (obj.name && (obj.parameters || obj.arguments)) {
                  found.push({
                    name: obj.name,
                    args: (obj.parameters ?? obj.arguments) as Record<
                      string,
                      unknown
                    >,
                  });
                }
              } catch {
                /* ignore */
              }
              break;
            }
          }
        }
      }
    }
  }
  return found;
}

async function executeNamedTool(
  tools: ToolMap,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: unknown }> {
  const t = (
    tools as unknown as Record<
      string,
      { execute?: (a: unknown, opts?: unknown) => Promise<unknown> }
    >
  )[name];
  if (!t?.execute) {
    return { ok: false, output: `Unknown tool: ${name}` };
  }
  try {
    const output = await t.execute(args, { toolCallId: name, messages: [] });
    return { ok: true, output };
  } catch (e) {
    return {
      ok: false,
      output: e instanceof Error ? e.message : String(e),
    };
  }
}

async function synthesizeAnswer(input: {
  llm: LLMSettings;
  history: ChatMessage[];
  context: string;
  toolEvents: AgentToolEvent[];
  priorText: string;
}): Promise<string> {
  const model = createModelFromSettings(input.llm);
  const toolBlock =
    input.toolEvents.length === 0
      ? "(no tool results)"
      : input.toolEvents
          .map(
            (t) =>
              `### ${t.name}\nInput: ${t.input ?? ""}\nResult:\n${t.output ?? ""}`,
          )
          .join("\n\n");

  const recent = input.history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const result = await generateText({
    model,
    temperature: Math.min(input.llm.temperature, 0.4),
    providerOptions: ollamaProviderOptions(input.llm),
    prompt: `You are the Liquid Copy agent. Answer the user's latest question using the conversation, retrieved knowledge, and tool results below.

RULES:
- Reply with a direct, useful answer to the user. No tool JSON. No "I will call…".
- Use conversation memory (earlier turns) when the user says "so..", "and?", or refers to prior topics.
- Prefer facts from tool results and KB/RAG context. If unknown, say so briefly.

Conversation:
${recent}

Knowledge context:
${input.context}

Tool results:
${toolBlock}

The previous incomplete model output was:
${input.priorText.slice(0, 500)}

Now write the final user-facing answer:`,
  });

  return (result.text || "").trim();
}

function systemInstructions(context: string): string {
  return `You are the Liquid Copy agent in a chat UI with conversation memory.

CRITICAL RULES:
1. ALWAYS end with a clear answer to the user. Never stop after announcing a tool call.
2. NEVER print tool-call JSON, function schemas, or lines like "I will call search_rag". Use native tools only; the runtime executes them.
3. After tools run, synthesize a short factual answer from their results.
4. Prefer answering from the retrieved RAG/KB context below when it already contains the answer — call search_rag only if you need more.
5. Remember earlier turns (e.g. a company just ingested). Follow-ups like "so.." mean continue that topic.

Tools (native only — do not narrate them):
- search_rag, list_kb, read_markdown, ingest_website, save_to_rag
- generate_testing_plan, query_testing_plan, update_testing_plan
- queue_carousel — when the user wants a carousel, pass idea + audience/platform if known, and ALWAYS include a full slides[] outline (hook → problem → insight → proof → cta). Titles ≤10 words, subtitles concrete (not filler).
- get_analytics, list_pending_approvals, approve_checkpoint

Be concise. No hype.

${context}`;
}

/**
 * Liquid Copy chat agent via Vercel AI SDK ToolLoopAgent.
 * Recovers when local models (Ollama) print tool JSON instead of calling tools.
 */
export async function runLiquidCopyAgent(
  input: RunLiquidCopyAgentInput,
): Promise<RunLiquidCopyAgentResult> {
  const model = createModelFromSettings(input.llm);
  const tools = createLiquidCopyTools(input.deps);
  const context = formatContext(input.passages, input.markdownSources);
  const messages = toModelMessages(input.history);
  const lastUser =
    [...input.history].reverse().find((m) => m.role === "user")?.content ?? "";

  const agent = new ToolLoopAgent({
    model,
    temperature: input.llm.temperature,
    stopWhen: stepCountIs(8),
    instructions: systemInstructions(context),
    tools,
    providerOptions: ollamaProviderOptions(input.llm),
  });

  let result = await agent.generate({ messages });
  let toolsUsed = collectToolEvents(result.steps);
  let reply = (result.text || "").trim();

  // Recovery: model narrated tools / printed JSON without a real answer
  if (looksLikeToolNarration(reply) || (toolsUsed.length > 0 && !reply)) {
    const faux = parseFauxToolCalls(reply);
    if (faux.length === 0 && toolsUsed.length === 0) {
      // Force a RAG search from the user question / prior context
      faux.push({
        name: "search_rag",
        args: { query: lastUser.slice(0, 200) || "company goals mission", limit: 8 },
      });
    }

    for (const call of faux) {
      const executed = await executeNamedTool(tools, call.name, call.args);
      toolsUsed.push({
        name: call.name,
        input: JSON.stringify(call.args),
        output:
          typeof executed.output === "string"
            ? executed.output
            : JSON.stringify(executed.output, null, 2),
      });
    }

    // If native tools ran but text is empty/narration, still synthesize
    if (toolsUsed.length === 0 && input.passages.length === 0) {
      const executed = await executeNamedTool(tools, "search_rag", {
        query: lastUser.slice(0, 200),
        limit: 8,
      });
      toolsUsed.push({
        name: "search_rag",
        input: lastUser.slice(0, 120),
        output:
          typeof executed.output === "string"
            ? executed.output
            : JSON.stringify(executed.output, null, 2),
      });
    }

    reply = await synthesizeAnswer({
      llm: input.llm,
      history: input.history,
      context,
      toolEvents: toolsUsed,
      priorText: reply || "(empty)",
    });
  }

  // Still empty? One more synthesize from prefetched context only
  if (!reply.trim()) {
    reply = await synthesizeAnswer({
      llm: input.llm,
      history: input.history,
      context,
      toolEvents: toolsUsed,
      priorText: "(empty)",
    });
  }

  return {
    reply: reply.trim() || "I could not produce an answer. Try asking again more specifically.",
    tools: toolsUsed,
  };
}
