import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { TextArea } from "../../components/ui/Input";
import { Progress, StreamingCaret } from "../../components/ui/Progress";
import { api, type ChatMessage } from "../../lib/api";
import { useDataMode } from "../../lib/hooks";
import { loadSettings } from "../../lib/settings";
import "./workspace.css";
import "./Chat.css";
import "../../components/ui/Input.css";

function uid() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: uid(), role, content, at: new Date().toISOString() };
}

export function ChatPage() {
  const { simulation } = useDataMode();
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    msg(
      "assistant",
      "I'm the Liquid Copy agent. Ask me to ingest a website into RAG, generate/query/update the testing plan, queue a carousel from an idea, or save notes.",
    ),
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const llm = loadSettings().llm;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const nextHistory = [...messages, msg("user", content)];
    setMessages(nextHistory);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const result = await api.agentChat(nextHistory);
      setMessages((prev) => [...prev, msg("assistant", result.reply)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="page chat-page stagger-in">
      <header className="page-header">
        <div>
          <p className="eyebrow">Agent</p>
          <h1 className="page-title">Chat</h1>
        </div>
        <Badge tone={simulation ? "processing" : "active"}>
          {simulation ? "Simulation" : "Live"} · {llm.provider}/{llm.model}
        </Badge>
      </header>

      <p className="page-lead">
        Main workspace. Grounded in RAG, KB markdown, and agent tools — ask
        here, or open <Link to="/app/test">Test</Link> to publish carousels.
      </p>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="panel chat-main">
        <div className="chat-thread" role="log" aria-live="polite">
          {messages.map((m) => (
            <article
              key={m.id}
              className={`chat-bubble chat-bubble--${m.role}`}
            >
              <header className="chat-bubble-head">
                <span>{m.role === "user" ? "You" : "Agent"}</span>
                <time className="panel-meta">
                  {new Date(m.at).toLocaleTimeString()}
                </time>
              </header>
              <pre className="chat-bubble-body">{m.content}</pre>
            </article>
          ))}
          {busy ? (
            <p className="empty-state">
              Thinking
              <StreamingCaret />
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <form className="chat-composer" onSubmit={onSubmit}>
          <TextArea
            label="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the agent… (ingest https://…, queue a carousel, save to RAG)"
            rows={3}
            disabled={busy}
          />
          <div className="chat-composer-actions">
            <Button type="submit" variant="accent" disabled={busy || !input.trim()}>
              Send
            </Button>
          </div>
        </form>
        <Progress active={busy} label="Agent · RAG · tools" />
      </section>
    </div>
  );
}
