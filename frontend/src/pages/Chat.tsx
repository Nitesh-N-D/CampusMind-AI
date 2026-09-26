import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Seal, type TrustLevel } from "@/components/Seal";
import { MarkIcon } from "@/components/Brand";
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
    "What are the exam fees for my programme?",
    "Give me a checklist for placement registration.",
  ],
  faculty: [
    "Summarize the current academic regulations",
    "Summarize this week's circulars for my department.",
    "What are the upcoming exam schedule dates?",
    "Give me a summary of the latest placement drive.",
    "What deadlines affect faculty this month?",
  ],
  // Admins don't use chat as end users - these are spot-checks that an
  // uploaded document is being retrieved and cited correctly.
  admin: [
    "What is the minimum attendance requirement?",
    "Summarize the latest uploaded circular.",
    "When is the next placement drive?",
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
  const isAdmin = role === "admin";
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Grow the composer with its content, up to a cap, like any chat app.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const voice = useVoiceInput(language, (transcript) => {
    setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
  });

  useEffect(() => {
    if (voice.error) toastError(voice.error);
  }, [voice.error]);

  const currentTitle = sessions.find((s) => s.id === activeSession)?.title;

  const sessionListContent = (
    <>
      <div className="p-3 shrink-0">
        <Button
          variant="secondary"
          className="w-full !py-2 text-sm !justify-start"
          onClick={() => {
            startNewChat();
            setHistoryOpen(false);
            inputRef.current?.focus();
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          New conversation
        </Button>
      </div>
      <nav aria-label="Conversations" className="flex-1 overflow-y-auto px-2 pb-3">
        {sessionsLoading && (
          <div className="flex flex-col gap-2 p-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 rounded-[var(--radius-control)] bg-paper-200 animate-pulse" />
            ))}
          </div>
        )}
        {!sessionsLoading && sessions.length === 0 && (
          <p className="text-xs text-ink-500 px-3 py-4">Your conversations will appear here.</p>
        )}
        {!sessionsLoading &&
          groupSessions(sessions).map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-ink-500">{group.label}</p>
              {group.items.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    openSession(s.id);
                    setHistoryOpen(false);
                  }}
                  aria-current={activeSession === s.id ? "page" : undefined}
                  className={`w-full text-left text-sm px-3 py-2 rounded-[var(--radius-control)] truncate transition-colors ${
                    activeSession === s.id
                      ? "bg-violet-50 text-violet-600 font-medium"
                      : "text-ink-700 hover:bg-surface-hover"
                  }`}
                >
                  {s.title || "New conversation"}
                </button>
              ))}
            </div>
          ))}
      </nav>
    </>
  );

  return (
    <AppShell fullBleed>
      <div className="h-full flex">
        {/* Conversation list - desktop */}
        <aside className="hidden lg:flex flex-col w-72 shrink-0 border-r border-line bg-surface">
          {sessionListContent}
        </aside>

        {/* Conversation list - phone/tablet drawer */}
        {historyOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <button
              aria-label="Close conversation history"
              className="absolute inset-0 bg-black/40"
              onClick={() => setHistoryOpen(false)}
            />
            <div className="relative w-80 max-w-[85vw] bg-surface h-full flex flex-col shadow-[var(--shadow-raised)]">
              <div className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
                <span className="font-medium text-sm text-ink-900">Conversations</span>
                <button
                  aria-label="Close"
                  onClick={() => setHistoryOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-ink-700 hover:bg-surface-hover"
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

        {/* Conversation */}
        <section className="flex-1 min-w-0 flex flex-col" aria-label="Conversation">
          <div className="h-12 shrink-0 flex items-center gap-2 px-3 sm:px-5 border-b border-line bg-surface/60">
            <button
              aria-label="Show conversation history"
              onClick={() => setHistoryOpen(true)}
              className="lg:hidden w-8 h-8 shrink-0 flex items-center justify-center rounded-[var(--radius-control)] text-ink-700 hover:bg-surface-hover"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M4 6h16M4 12h10M4 18h7" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
            <h1 className="flex-1 min-w-0 truncate text-sm font-medium text-ink-900">
              {currentTitle || (isAdmin ? "Test a question" : "New conversation")}
            </h1>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="h-8 text-xs border border-line-strong rounded-[var(--radius-control)] px-2 bg-surface text-ink-800 shrink-0"
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
                className="h-8 w-8 shrink-0 flex items-center justify-center rounded-[var(--radius-control)] text-ink-500 hover:text-ink-900 hover:bg-surface-hover"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
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

          <div className="flex-1 overflow-y-auto" aria-live="polite">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-7">
              {messages.length === 0 && (
                <div className="pt-4 sm:pt-12">
                  <h2 className="font-display text-2xl sm:text-3xl text-ink-950">
                    {isAdmin
                      ? "Spot-check your knowledge base"
                      : fullName
                      ? `Hi ${fullName.split(" ")[0]}, what do you need to know?`
                      : "What do you need to know?"}
                  </h2>
                  <p className="text-sm text-ink-500 mt-2 max-w-xl">
                    {isAdmin
                      ? "This assistant is built for your students and faculty. Ask a test question to confirm an upload is retrieved and cited correctly - admin test questions aren't counted in usage analytics."
                      : `Answers come only from ${collegeName ?? "your college"}'s official documents, with a citation for every source.`}
                  </p>
                  <div className="grid sm:grid-cols-2 gap-2.5 mt-8">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="text-left text-sm bg-surface hover:bg-surface-hover border border-line hover:border-line-strong px-4 py-3 rounded-[var(--radius-control)] transition-colors text-ink-800"
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
          </div>

          <div className="shrink-0 px-3 sm:px-6 pb-3 sm:pb-5 pt-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="max-w-3xl mx-auto flex items-end gap-2 bg-surface border border-line-strong focus-within:border-violet-500 rounded-2xl p-2 shadow-[var(--shadow-card)] transition-colors"
            >
              <label htmlFor="chat-input" className="sr-only">
                Ask a question
              </label>
              <textarea
                id="chat-input"
                ref={inputRef}
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
                className="flex-1 resize-none bg-transparent text-sm text-ink-900 placeholder:text-ink-400 px-2.5 py-2 outline-none"
              />
              {voice.supported && (
                <button
                  type="button"
                  onClick={() => (voice.listening ? voice.stop() : voice.start())}
                  aria-label={voice.listening ? "Stop voice input" : "Start voice input"}
                  aria-pressed={voice.listening}
                  className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-full transition-colors ${
                    voice.listening
                      ? "bg-seal-coral-600 text-white animate-pulse"
                      : "text-ink-500 hover:text-ink-900 hover:bg-surface-hover"
                  }`}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" strokeWidth="1.6" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              )}
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full bg-navy-700 text-on-navy hover:bg-navy-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? (
                  <Spinner className="w-4 h-4" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </form>
            <p className="max-w-3xl mx-auto text-center text-[11px] text-ink-500 mt-2 px-2">
              Answers are drawn from uploaded official documents. Check the cited source before acting on a deadline.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function groupSessions(sessions: ChatSessionOut[]): { label: string; items: ChatSessionOut[] }[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(startOfToday);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const groups: { label: string; items: ChatSessionOut[] }[] = [
    { label: "Today", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const s of sessions) {
    const created = new Date(s.created_at);
    const group = created >= startOfToday ? groups[0] : created >= weekAgo ? groups[1] : groups[2];
    group.items.push(s);
  }
  return groups.filter((g) => g.items.length > 0);
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
        <div className="bg-navy-700 text-on-navy rounded-2xl rounded-br-md px-4 py-2.5 text-sm max-w-[85%] sm:max-w-[75%] whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full border border-line bg-surface flex items-center justify-center">
        <MarkIcon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        {message.pending ? (
          <div className="flex items-center gap-2 text-ink-500 text-sm py-1">
            <Spinner className="w-4 h-4" />
            Checking your college's documents...
          </div>
        ) : (
          <>
            <div className="text-[15px] text-ink-900 leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </div>

            {message.hasConflict && message.conflicts && message.conflicts.length > 0 && (
              <div className="mt-3 space-y-2">
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
                        One source says <strong>{c.value_a}</strong>, another says <strong>{c.value_b}</strong>.{" "}
                        {c.reasoning}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {message.citations && message.citations.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wider text-ink-500 mb-2">Sources</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {message.citations.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 border border-line rounded-[var(--radius-control)] px-3 py-2.5 bg-surface"
                    >
                      <Seal score={c.trust_score} level={(c.trust_level as TrustLevel) || "medium"} size="sm" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-ink-800 truncate">{c.document_title}</p>
                        <p className="text-[11px] text-ink-500 truncate" style={{ fontFamily: "var(--font-mono)" }}>
                          {c.page ? `Page ${c.page}` : c.section || "Source"}
                          {c.department ? ` - ${c.department}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!message.abstained && typeof message.confidence === "number" && (
              <div className="flex items-center gap-3 mt-3">
                <span className="text-[11px] text-ink-500" style={{ fontFamily: "var(--font-mono)" }}>
                  confidence {Math.round(message.confidence)}%
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    aria-label="Good answer"
                    aria-pressed={feedbackGiven === "up"}
                    onClick={() => {
                      onFeedback(message.id, "up");
                      setFeedbackGiven("up");
                    }}
                    className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors hover:bg-surface-hover ${
                      feedbackGiven === "up" ? "text-seal-teal-700" : "text-ink-400 hover:text-ink-800"
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                      <path d="M7 22V11l5-9 1.5 1L12 11h8l-2 11H9l-2-1Z" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    aria-label="Report incorrect answer"
                    aria-pressed={feedbackGiven === "down"}
                    onClick={() => {
                      onFeedback(message.id, "down");
                      setFeedbackGiven("down");
                    }}
                    className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors hover:bg-surface-hover ${
                      feedbackGiven === "down" ? "text-seal-coral-700" : "text-ink-400 hover:text-ink-800"
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                      <path d="M17 2v11l-5 9-1.5-1L12 13H4l2-11h11l2 1Z" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { confidenceLevel };

