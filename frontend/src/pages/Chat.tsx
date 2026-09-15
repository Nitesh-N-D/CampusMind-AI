import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Seal, type TrustLevel } from "@/components/Seal";
import { Button, ErrorBanner, Spinner } from "@/components/ui";
import { api, ApiError, type ChatMessageOut, type ChatSessionOut, type Citation } from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { toastError } from "@/lib/toastStore";
import { conversationToMarkdown, downloadMarkdown } from "@/lib/exportConversation";

const SUGGESTIONS_BY_ROLE: Record<string, string[]> = {
  student: [
    "What is the minimum attendance requirement?",
    "What deadlines are coming up this month?",
    "Summarize the latest placement notice.",
    "What changed in the latest regulations?",
    "Give me a checklist for placement registration.",
  ],
  faculty: [
    "What changed in the latest academic regulations?",
    "Summarize this week's circulars for my department.",
    "What are the upcoming exam schedule dates?",
    "Give me a summary of the latest placement drive.",
    "What deadlines affect faculty this month?",
  ],
  admin: [
    "What conflicting sources need my review?",
    "Summarize the latest uploaded circular.",
    "What deadlines are coming up this month?",
    "What changed in the latest regulations?",
  ],
};

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ta", label: "தமிழ்" },
  { code: "hi", label: "हिन्दी" },
];

interface LocalMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  confidence?: number | null;
  hasConflict?: boolean;
  conflicts?: { topic: string; value_a: string; value_b: string; reasoning: string }[];
  abstained?: boolean;
  pending?: boolean;
}

function confidenceLevel(score: number): TrustLevel {
  if (score >= 80) return "very_high";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export default function Chat() {
  const fullName = useAuthStore((s) => s.fullName);
  const collegeName = useAuthStore((s) => s.collegeName);
  const role = useAuthStore((s) => s.role);
  const suggestions = SUGGESTIONS_BY_ROLE[role ?? "student"] ?? SUGGESTIONS_BY_ROLE.student;
  const [sessions, setSessions] = useState<ChatSessionOut[]>([]);
  const [activeSession, setActiveSession] = useState<number | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState("en");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const list = await api.chat.sessions();
      setSessions(list);
    } catch {
      // Non-fatal: chat still works without history sidebar
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openSession = async (sessionId: number) => {
    setActiveSession(sessionId);
    setError(null);
    try {
      const msgs: ChatMessageOut[] = await api.chat.messages(sessionId);
      setMessages(
        msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations,
          confidence: m.confidence,
          hasConflict: m.has_conflict,
        }))
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load that conversation.");
    }
  };

  const startNewChat = () => {
    setActiveSession(null);
    setMessages([]);
    setError(null);
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    setError(null);
    setInput("");
    const tempId = Date.now();
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: "user", content },
      { id: tempId + 1, role: "assistant", content: "", pending: true },
    ]);
    setSending(true);
    try {
      const res = await api.chat.send({ message: content, session_id: activeSession, language });
      setActiveSession(res.session_id);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId + 1
            ? {
                id: res.message_id,
                role: "assistant",
                content: res.answer,
                citations: res.citations,
                confidence: res.confidence,
                hasConflict: res.has_conflict,
                conflicts: res.conflicts,
                abstained: res.abstained,
              }
            : m
        )
      );
      loadSessions();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId + 1));
      setError(
        err instanceof ApiError ? err.message : "CampusMind AI is temporarily unavailable. Please try again."
      );
    } finally {
      setSending(false);
    }
  };

  const giveFeedback = async (messageId: number, value: "up" | "down") => {
    try {
      await api.chat.feedback(messageId, value);
    } catch {
      // best-effort, no need to interrupt the reading flow
    }
  };

  const exportConversation = () => {
    const currentSession = sessions.find((s) => s.id === activeSession);
    const md = conversationToMarkdown(
      messages.filter((m) => !m.pending),
      {
        collegeName,
        exportedBy: fullName,
        sessionTitle: currentSession?.title,
      }
    );
    const filename = `campusmind-conversation-${new Date().toISOString().slice(0, 10)}.md`;
    downloadMarkdown(md, filename);
  };

  const [historyOpen, setHistoryOpen] = useState(false);

  const voice = useVoiceInput(language, (transcript) => {
    setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
  });

  useEffect(() => {
    if (voice.error) toastError(voice.error);
  }, [voice.error]);

  const sessionListContent = (
    <>
      <div className="p-3 border-b border-line">
        <Button
          variant="secondary"
          className="w-full !py-2 text-sm"
          onClick={() => {
            startNewChat();
            setHistoryOpen(false);
          }}
        >
          + New conversation
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessionsLoading && (
          <div className="flex flex-col gap-2 p-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 rounded-[var(--radius-control)] bg-paper-200 animate-pulse" />
            ))}
          </div>
        )}
        {!sessionsLoading && sessions.length === 0 && (
          <p className="text-xs text-ink-400 text-center px-3 py-6">
            Your conversations will appear here.
          </p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              openSession(s.id);
              setHistoryOpen(false);
            }}
            className={`w-full text-left text-sm px-3 py-2.5 rounded-[var(--radius-control)] truncate transition-colors ${
              activeSession === s.id ? "bg-violet-50 text-violet-600 font-medium" : "text-ink-700 hover:bg-paper-100"
            }`}
          >
            {s.title || "New conversation"}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <AppShell>
      <div className="flex gap-6 h-[calc(100vh-8rem)] md:h-[calc(100vh-4rem)]">
        {/* Session list - desktop */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 border border-line rounded-[var(--radius-card)] bg-surface overflow-hidden">
          {sessionListContent}
        </aside>

        {/* Session list - mobile/tablet drawer */}
        {historyOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <button
              aria-label="Close conversation history"
              className="absolute inset-0 bg-black/30"
              onClick={() => setHistoryOpen(false)}
            />
            <div className="relative w-72 max-w-[85vw] bg-surface h-full flex flex-col shadow-[var(--shadow-raised)]">
              <div className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
                <span className="font-medium text-sm text-ink-900">Conversations</span>
                <button
                  aria-label="Close"
                  onClick={() => setHistoryOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-paper-200"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">{sessionListContent}</div>
            </div>
          </div>
        )}

        {/* Main chat column */}
        <div className="flex-1 min-w-0 flex flex-col border border-line rounded-[var(--radius-card)] bg-surface overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-line gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                aria-label="Show conversation history"
                onClick={() => setHistoryOpen(true)}
                className="lg:hidden w-8 h-8 shrink-0 flex items-center justify-center rounded-[var(--radius-control)] border border-line-strong text-ink-600"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path d="M4 6h16M4 12h9M4 18h6" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <div className="min-w-0">
                <h1 className="font-display text-lg text-ink-950">Ask CampusMind</h1>
                <p className="text-xs text-ink-400 truncate">Grounded in your college's official documents only</p>
              </div>
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="h-9 text-sm border border-line-strong rounded-[var(--radius-control)] px-2.5 bg-surface shrink-0"
              aria-label="Response language"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            {messages.some((m) => !m.pending) && (
              <button
                onClick={exportConversation}
                aria-label="Export conversation"
                title="Export conversation as Markdown"
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-[var(--radius-control)] border border-line-strong text-ink-600 hover:border-navy-700"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path
                    d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
            {messages.length === 0 && (
              <div className="max-w-lg mx-auto text-center pt-8">
                <h2 className="font-display text-xl text-ink-900">
                  {fullName ? `Hi ${fullName.split(" ")[0]}, what do you need to know?` : "What do you need to know?"}
                </h2>
                <p className="text-sm text-ink-500 mt-2">
                  Try one of these, or ask anything about your college.
                </p>
                <div className="flex flex-col gap-2 mt-6">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left text-sm bg-paper-100 hover:bg-paper-200 border border-line px-4 py-3 rounded-[var(--radius-control)] transition-colors text-ink-800"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onFeedback={giveFeedback} />
            ))}
            {error && <ErrorBanner message={error} onRetry={() => setError(null)} />}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="border-t border-line p-4 flex items-end gap-3"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about attendance, exams, placements, fees..."
              rows={1}
              className="flex-1 resize-none max-h-32 text-sm border border-line-strong rounded-[var(--radius-control)] px-3.5 py-2.5 outline-none focus:border-navy-700"
            />
            {voice.supported && (
              <button
                type="button"
                onClick={() => (voice.listening ? voice.stop() : voice.start())}
                aria-label={voice.listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={voice.listening}
                className={`h-11 w-11 shrink-0 flex items-center justify-center rounded-[var(--radius-control)] border transition-colors ${
                  voice.listening
                    ? "bg-seal-coral-600 border-seal-coral-600 text-white animate-pulse"
                    : "border-line-strong text-ink-600 hover:border-navy-700"
                }`}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" strokeWidth="1.6" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            )}
            <Button type="submit" disabled={sending || !input.trim()}>
              {sending ? <Spinner /> : "Send"}
            </Button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}

function MessageBubble({
  message,
  onFeedback,
}: {
  message: LocalMessage;
  onFeedback: (id: number, value: "up" | "down") => void;
}) {
  const [feedbackGiven, setFeedbackGiven] = useState<"up" | "down" | null>(null);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-navy-700 text-paper-50 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[80%]">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.pending) {
    return (
      <div className="flex items-center gap-2 text-ink-400 text-sm">
        <Spinner />
        CampusMind AI is checking your college's documents...
      </div>
    );
  }

  return (
    <div className="max-w-[92%]">
      <div className="bg-paper-100 border border-line rounded-2xl rounded-tl-sm px-4 py-3.5 text-sm text-ink-800 leading-relaxed whitespace-pre-wrap">
        {message.content}
      </div>

      {message.hasConflict && message.conflicts && message.conflicts.length > 0 && (
        <div className="mt-2 space-y-2">
          {message.conflicts.map((c, i) => (
            <div
              key={i}
              className="flex gap-2.5 text-xs text-seal-amber-900 bg-seal-amber-50 border border-seal-amber-100 rounded-[var(--radius-control)] px-3.5 py-3"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="shrink-0 mt-0.5"
                aria-hidden="true"
              >
                <path d="M12 3 3 20h18L12 3Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M12 9.5v4.5M12 17h.01" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <div>
                <p className="font-medium">Conflicting official sources on {c.topic}</p>
                <p className="mt-1">
                  One source says <strong>{c.value_a}</strong>, another says{" "}
                  <strong>{c.value_b}</strong>. {c.reasoning}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {message.citations && message.citations.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {message.citations.map((c, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border border-line rounded-[var(--radius-control)] px-3 py-2.5 bg-surface"
            >
              <Seal score={c.trust_score} level={(c.trust_level as TrustLevel) || "medium"} size="sm" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink-800 truncate">{c.document_title}</p>
                <p className="text-[11px] text-ink-400" style={{ fontFamily: "var(--font-mono)" }}>
                  {c.page ? `Page ${c.page}` : "Source"}
                  {c.department ? ` - ${c.department}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!message.abstained && typeof message.confidence === "number" && (
        <div className="flex items-center gap-3 mt-2.5">
          <span className="text-[11px] text-ink-400" style={{ fontFamily: "var(--font-mono)" }}>
            confidence {Math.round(message.confidence)}%
          </span>
          <div className="flex items-center gap-1">
            <button
              aria-label="Good answer"
              onClick={() => {
                onFeedback(message.id, "up");
                setFeedbackGiven("up");
              }}
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                feedbackGiven === "up" ? "text-seal-teal-600" : "text-ink-300 hover:text-ink-600"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M7 22V11l5-9 1.5 1L12 11h8l-2 11H9l-2-1Z" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              aria-label="Report incorrect answer"
              onClick={() => {
                onFeedback(message.id, "down");
                setFeedbackGiven("down");
              }}
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                feedbackGiven === "down" ? "text-seal-coral-600" : "text-ink-300 hover:text-ink-600"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M17 2v11l-5 9-1.5-1L12 13H4l2-11h11l2 1Z" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { confidenceLevel };
