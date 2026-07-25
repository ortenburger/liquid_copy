import type { ChatMessage } from "./api";

const STORAGE_KEY = "liquid-copy.chat-history.v1";
const MAX_MESSAGES = 20;

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as ChatMessage;
  return (
    typeof m.id === "string" &&
    typeof m.role === "string" &&
    typeof m.content === "string" &&
    typeof m.at === "string"
  );
}

export function loadChatHistory(): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const messages = parsed.filter(isChatMessage);
    return messages.length > 0 ? messages.slice(-MAX_MESSAGES) : null;
  } catch {
    return null;
  }
}

export function saveChatHistory(messages: ChatMessage[]): void {
  const capped = messages.slice(-MAX_MESSAGES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
}

export function clearChatHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
