import { ToolLoopAgent, stepCountIs } from "ai";
import type { LLMSettings } from "../settings";
import type { RAGPassage } from "../types";
import { createModelFromSettings } from "./model";
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

  return `Retrieved RAG passages (may be incomplete — use tools to fetch more):\n${passageBlock}\n\nKB markdown already loaded:\n${markdownBlock}`;
}

function toModelMessages(history: ChatMessage[]) {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-12)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
}

function collectToolEvents(
  steps: Array<{ toolResults?: ReadonlyArray<{ toolName: string; input?: unknown; output?: unknown }> }>,
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

/**
 * Liquid Copy chat agent via Vercel AI SDK ToolLoopAgent.
 * The model decides which tools to call; the SDK runs the tool loop.
 */
export async function runLiquidCopyAgent(
  input: RunLiquidCopyAgentInput,
): Promise<RunLiquidCopyAgentResult> {
  const model = createModelFromSettings(input.llm);
  const tools = createLiquidCopyTools(input.deps);
  const context = formatContext(input.passages, input.markdownSources);

  const agent = new ToolLoopAgent({
    model,
    temperature: input.llm.temperature,
    stopWhen: stepCountIs(8),
    instructions: `You are the Liquid Copy agent. The main UI is this chat.

Use tools when you need fresh data or to take actions. Prefer tools over guessing.

Testing plan tools:
- query_testing_plan — read current roadmap + hypotheses
- generate_testing_plan — create/regenerate a plan (optional focus)
- update_testing_plan — revise roadmap and/or hypotheses (pass structured fields)

Carousel tools:
- queue_carousel — turn an idea/concept from the conversation (or instruction) into a queued Open Carrusel deck; pass idea + optional slides you draft from that concept. User can preview/publish on the Test tab.

Ground answers in tool results and the retrieved context below. Be concise and actionable. No hype.

${context}`,
    tools,
  });

  const result = await agent.generate({
    messages: toModelMessages(input.history),
  });

  return {
    reply: (result.text || "").trim() || "(No response from model.)",
    tools: collectToolEvents(result.steps),
  };
}
