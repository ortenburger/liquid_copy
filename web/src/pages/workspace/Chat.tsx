import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { TextArea } from "../../components/ui/Input";
import { Progress, StreamingCaret } from "../../components/ui/Progress";
import { WorkflowStagesPanel } from "../../components/workspace/WorkflowStagesPanel";
import {
  api,
  type AgentToolEvent,
  type ChatMessage,
  type RagMarkdownSource,
} from "../../lib/api";
import { useDataMode, useWorkflowStatus } from "../../lib/hooks";
import { loadSettings } from "../../lib/settings";
import type { RAGPassage } from "../../lib/types";
import "./workspace.css";
import "./Chat.css";
import "../../components/ui/Input.css";

function uid() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: uid(), role, content, at: new Date().toISOString() };
}

const QUICK_PROMPTS = [
  "What's in our knowledge base?",
  "Generate a testing plan focused on LinkedIn pain hooks",
  "Show me the current testing plan",
  "Queue a carousel about operational-pain hooks for Series A growth leads",
  "How are experiments performing?",
  "Save to RAG as chat-note: Series A growth leads hate calendar busywork.",
];

export function ChatPage() {
  const { simulation } = useDataMode();
  const workflowStatus = useWorkflowStatus();
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    msg(
      "assistant",
      "I'm the Liquid Copy agent. Ask me to generate/query/update the testing plan, queue a carousel from an idea we discuss, save to RAG, or check analytics.",
    ),
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<AgentToolEvent[]>([]);
  const [passages, setPassages] = useState<RAGPassage[]>([]);
  const [mdSources, setMdSources] = useState<RagMarkdownSource[]>([]);
  const [meta, setMeta] = useState<string | null>(null);
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
    setTools([]);
    setPassages([]);
    setMdSources([]);

    try {
      const result = await api.agentChat(nextHistory);
      setMessages((prev) => [...prev, msg("assistant", result.reply)]);
      setTools(result.tools);
      setPassages(result.passages);
      setMdSources(result.markdownSources);
      setMeta(
        `${result.provider} · ${result.model} · ${result.passages.length} passages · ${result.markdownSources.length} md · ${result.tools.length} tools`,
      );
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
        Main workspace. Grounded in RAG + KB markdown + analytics tools. Open{" "}
        <Link to="/app/testing-plan">Testing plan</Link> for the full stage
        rail, or <Link to="/app/analytics">Analytics</Link>.
      </p>

      <WorkflowStagesPanel status={workflowStatus} />

      {error ? <p className="error-banner">{error}</p> : null}

      <div className="chat-layout">
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
                Retrieving RAG + markdown, running tools
                <StreamingCaret />
              </p>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="chip-cloud chat-quick">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                type="button"
                className="org-scope-chip"
                disabled={busy}
                onClick={() => void send(q)}
              >
                {q}
              </button>
            ))}
          </div>

          <form className="chat-composer" onSubmit={onSubmit}>
            <TextArea
              label="Message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the agent… (generate plan, queue a carousel about …, save to RAG)"
              rows={3}
              disabled={busy}
            />
            <div className="chat-composer-actions">
              <Button type="submit" variant="accent" disabled={busy || !input.trim()}>
                Send
              </Button>
            </div>
          </form>
          <Progress active={busy} label="Agent · RAG · tools · Ollama" />
          {meta ? <p className="panel-meta">{meta}</p> : null}
        </section>

        <aside className="chat-side">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Tools used</h2>
              <span className="panel-meta">{tools.length}</span>
            </div>
            {tools.length === 0 ? (
              <p className="empty-state">
                The model chooses tools via AI SDK (generate/query/update
                testing plan, save_to_rag, get_analytics…).
              </p>
            ) : (
              <ul className="list-stack">
                {tools.map((t, i) => (
                  <li key={`${t.name}-${i}`} className="list-row">
                    <div className="list-row-main">
                      <div className="list-row-title">
                        <Badge tone="processing">{t.name}</Badge>
                        {t.input ? (
                          <span className="panel-meta">{t.input}</span>
                        ) : null}
                      </div>
                      <pre className="chat-tool-out">{t.output}</pre>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Markdown context</h2>
              <span className="panel-meta">{mdSources.length}</span>
            </div>
            {mdSources.length === 0 ? (
              <p className="empty-state">No MD files loaded for the last turn.</p>
            ) : (
              <ul className="chip-cloud">
                {mdSources.map((m) => (
                  <li key={m.entityId}>
                    <span className="org-scope-chip is-active">
                      {m.entityId}.md
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">RAG passages</h2>
              <span className="panel-meta">{passages.length}</span>
            </div>
            {passages.length === 0 ? (
              <p className="empty-state">No passages for the last turn.</p>
            ) : (
              <ul className="list-stack">
                {passages.slice(0, 4).map((p) => (
                  <li
                    key={`${p.sourceDoc}-${p.similarityScore}`}
                    className="list-row"
                  >
                    <div className="list-row-main">
                      <div className="list-row-title">
                        <Badge tone="idle">{p.scope}</Badge>
                        <Badge tone="processing">
                          {(p.similarityScore * 100).toFixed(0)}%
                        </Badge>
                      </div>
                      <p className="list-row-body">
                        {p.content.slice(0, 180)}
                        {p.content.length > 180 ? "…" : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
