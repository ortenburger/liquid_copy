import type { KBEntitySummary, RAGPassage } from "../types";

export type KBWriteEntityType = KBEntitySummary["entityType"];

export interface SaveToRagInput {
  entityId: string;
  entityType?: KBWriteEntityType;
  markdown: string;
  append?: boolean;
}

export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  at: string;
}

export interface AgentToolEvent {
  name: string;
  input?: string;
  output: string;
}

export interface RagMarkdownSource {
  entityId: string;
  entityType?: string;
  markdown: string;
}

export interface AgentChatResult {
  reply: string;
  passages: RAGPassage[];
  markdownSources: RagMarkdownSource[];
  tools: AgentToolEvent[];
  model: string;
  provider: string;
}
