import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { Seal, type TrustLevel } from "@/components/Seal";
import { MarkIcon } from "@/components/Brand";
import { Button, ErrorBanner, Spinner } from "@/components/ui";
import {
  api,
  ApiError,
  type ChatMessageOut,
  type ChatSessionOut,
  type Citation,
  type FeedbackReason,
} from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { toastError } from "@/lib/toastStore";
import { ChatExportDialog } from "@/components/ChatExportDialog";
import { LANGUAGES, useLanguageStore, useT, type MessageKey } from "@/lib/i18n";

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

// Quick campus actions. The label is localized; the query sent to the
// assistant stays English so retrieval matches the (English) documents.
const QUICK_ACTIONS: { key: MessageKey; query: string }[] = [
  { key: "quick.exam", query: "What is the exam schedule?" },
  { key: "quick.calendar", query: "Show the academic calendar." },
  { key: "quick.holidays", query: "What are the upcoming holidays?" },
  { key: "quick.deadlines", query: "What deadlines are coming up?" },
  { key: "quick.circulars", query: "Summarize the latest circulars." },
  { key: "quick.attendance", query: "What are the attendance rules?" },
  { key: "quick.assignments", query: "What assignments are due soon?" },
  { key: "quick.events", query: "What events are coming up?" },
];

const FEEDBACK_REASONS: FeedbackReason[] = ["incorrect", "missing", "poor_citation", "outdated", "other"];
const SIDEBAR_KEY = "cm_chat_sidebar";
const LOW_CONFIDENCE = 40;

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

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Chat() {
  const t = useT();
  const uiLanguage = useLanguageStore((s) => s.language);
  const fullName = useAuthStore((s) => s.fullName);
  const collegeName = useAuthStore((s) => s.collegeName);
  const role = useAuthStore((s) => s.role);
  const isAdmin = role === "admin";
  const suggestions = SUGGESTIONS_BY_ROLE[role ?? "student"] ?? SUGGESTIONS_BY_ROLE.student;
  const [params, setParams] = useSearchParams();
  const [sessions, setSessions] = useState<ChatSessionOut[]>([]);
  const [activeSession, setActiveSession] = useState<number | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  // null = follow the interface language; a manual pick overrides it.
  const [answerLanguage, setAnswerLanguage] = useState<string | null>(null);
  const language = answerLanguage ?? uiLanguage;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [search, setSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, prev ? "0" : "1");
      } catch {
        // Applies for this visit only.
      }
      return !prev;
    });
  };

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

  const deleteSession = async (sessionId: number) => {
    if (!window.confirm(t("chat.deleteConfirm"))) return;
    try {
      await api.chat.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSession === sessionId) startNewChat();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't delete that conversation.");
    }
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
      // Nothing was saved, so take the question back off the screen and put
      // it in the composer: one press of send retries it.
      setMessages((prev) => prev.filter((m) => m.id !== tempId && m.id !== tempId + 1));
      setInput(content);
      setError(err instanceof ApiError ? err.message : t("chat.unavailable"));
    } finally {
      setSending(false);
    }
  };

  // /chat?ask=... (from a notification's "Ask CampusMind" button) prefills the
  // composer rather than auto-sending, so the student can edit it first.
  useEffect(() => {
    const ask = params.get("ask");
    if (!ask) return;
    setInput(ask.slice(0, 2000));
    params.delete("ask");
    setParams(params, { replace: true });
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const giveFeedback = async (messageId: number, value: "up" | "down", reason?: FeedbackReason) => {
    try {
      await api.chat.feedback(messageId, value, reason);
    } catch {
      // best-effort, no need to interrupt the reading flow
    }
  };

  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? sessions.filter((s) => (s.title || "").toLowerCase().includes(q)) : sessions;
  }, [sessions, search]);

  const plusIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );

  // `compact` is the icon-only desktop rail; the drawer and the expanded
  // sidebar share the full layout.
  const renderSessionList = (compact: boolean) => (
    <>
      <div className={`shrink-0 ${compact ? "p-2 flex justify-center" : "p-3"}`}>
        {compact ? (
          <button
            onClick={() => {
              startNewChat();
              inputRef.current?.focus();
            }}
            aria-label={t("chat.newChat")}
            title={t("chat.newChat")}
            className="w-10 h-10 flex items-center justify-center rounded-[var(--radius-control)] bg-brand text-on-navy hover:brightness-110"
          >
            {plusIcon}
          </button>
        ) : (
          <Button
            className="w-full !py-2 text-sm !justify-start"
            onClick={() => {
              startNewChat();
              setHistoryOpen(false);
              inputRef.current?.focus();
            }}
          >
            {plusIcon}
            {t("chat.newChat")}
          </Button>
        )}
      </div>
      {!compact && (
        <div className="px-3 pb-2 shrink-0">
          <label htmlFor="chat-search" className="sr-only">
            {t("chat.searchChats")}
          </label>
          <input
            id="chat-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("chat.searchChats")}
            className="w-full h-9 text-sm rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-ink-900 placeholder:text-ink-400"
          />
        </div>
      )}
      {compact ? (
        <nav aria-label={t("chat.conversations")} className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col items-center gap-1">
          {filteredSessions.slice(0, 30).map((s) => (
            <button
              key={s.id}
              onClick={() => openSession(s.id)}
              aria-label={s.title || t("chat.newChat")}
              title={s.title || t("chat.newChat")}
              aria-current={activeSession === s.id ? "page" : undefined}
              className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-[var(--radius-control)] text-xs font-semibold ${
                activeSession === s.id ? "bg-violet-50 text-violet-600" : "text-ink-700 hover:bg-surface-hover"
              }`}
            >
              {(s.title || "?").trim().charAt(0).toUpperCase()}
            </button>
          ))}
        </nav>
      ) : (
        <nav aria-label={t("chat.conversations")} className="flex-1 overflow-y-auto px-2 pb-3">
          {sessionsLoading && (
            <div className="flex flex-col gap-2 p-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 rounded-[var(--radius-control)] bg-paper-200 animate-pulse" />
              ))}
            </div>
          )}
          {!sessionsLoading && sessions.length === 0 && (
            <p className="text-xs text-ink-500 px-3 py-4">{t("chat.historyEmpty")}</p>
          )}
          {!sessionsLoading && sessions.length > 0 && filteredSessions.length === 0 && (
            <p className="text-xs text-ink-500 px-3 py-4">{t("chat.noMatches")}</p>
          )}
          {!sessionsLoading &&
            groupSessions(filteredSessions).map((group) => (
              <div key={group.label} className="mb-3">
                <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-ink-500">{group.label}</p>
                {group.items.map((s) => (
                  <div
                    key={s.id}
                    className={`group flex items-center rounded-[var(--radius-control)] ${
                      activeSession === s.id ? "bg-violet-50" : "hover:bg-surface-hover"
                    }`}
                  >
                    <button
                      onClick={() => {
                        openSession(s.id);
                        setHistoryOpen(false);
                      }}
                      aria-current={activeSession === s.id ? "page" : undefined}
                      className={`flex-1 min-w-0 text-left text-sm px-3 py-2 truncate ${
                        activeSession === s.id ? "text-violet-600 font-medium" : "text-ink-700"
                      }`}
                    >
                      {s.title || t("chat.newChat")}
                    </button>
                    <button
                      onClick={() => deleteSession(s.id)}
                      aria-label={`${t("chat.deleteChat")}: ${s.title || t("chat.newChat")}`}
                      title={t("chat.deleteChat")}
                      className="shrink-0 w-8 h-8 mr-1 flex items-center justify-center rounded-full text-ink-400 hover:text-seal-coral-700 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path
                          d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ))}
        </nav>
      )}
    </>
  );

  return (
    <AppShell fullBleed>
      <div className="h-full flex">
        {/* Conversation list - desktop, collapsible */}
        <aside
          className={`hidden lg:flex flex-col shrink-0 border-r border-line bg-surface transition-[width] duration-200 ease-out ${
            collapsed ? "w-16" : "w-72"
          }`}
        >
          {renderSessionList(collapsed)}
          <div className={`shrink-0 border-t border-line p-2 flex ${collapsed ? "justify-center" : "justify-end"}`}>
            <button
              onClick={toggleCollapsed}
              aria-label={collapsed ? t("chat.expandSidebar") : t("chat.collapseSidebar")}
              aria-expanded={!collapsed}
              title={collapsed ? t("chat.expandSidebar") : t("chat.collapseSidebar")}
              className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-control)] text-ink-500 hover:text-ink-900 hover:bg-surface-hover"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
                className={collapsed ? "rotate-180" : ""}
              >
                <path d="M15 6l-6 6 6 6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </aside>

        {/* Conversation list - phone/tablet drawer */}
        {historyOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <button
              aria-label={t("chat.closeHistory")}
              className="absolute inset-0 bg-black/40"
              onClick={() => setHistoryOpen(false)}
            />
            <div className="relative w-80 max-w-[85vw] bg-surface h-full flex flex-col shadow-[var(--shadow-raised)]">
              <div className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
                <span className="font-medium text-sm text-ink-900">{t("chat.conversations")}</span>
                <button
                  aria-label={t("chat.closeHistory")}
                  onClick={() => setHistoryOpen(false)}
                  className="w-9 h-9 flex items-center justify-center rounded-full text-ink-700 hover:bg-surface-hover"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">{renderSessionList(false)}</div>
            </div>
          </div>
        )}

        {/* Conversation */}
        <section className="flex-1 min-w-0 flex flex-col" aria-label="Conversation">
          <div className="h-12 shrink-0 flex items-center gap-2 px-3 sm:px-5 border-b border-line bg-surface/60">
            <button
              aria-label={t("chat.showHistory")}
              onClick={() => setHistoryOpen(true)}
              className="lg:hidden w-9 h-9 shrink-0 flex items-center justify-center rounded-[var(--radius-control)] text-ink-700 hover:bg-surface-hover"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M4 6h16M4 12h10M4 18h7" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
            <h1 className="flex-1 min-w-0 truncate text-sm font-medium text-ink-900">
              {currentTitle || (isAdmin ? "Test a question" : t("chat.newChat"))}
            </h1>
            <select
              value={language}
              onChange={(e) => setAnswerLanguage(e.target.value)}
              className="h-8 text-xs border border-line-strong rounded-[var(--radius-control)] px-2 bg-surface text-ink-800 shrink-0"
              aria-label={t("chat.responseLanguage")}
              title={t("chat.responseLanguage")}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} lang={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            {!isAdmin && sessions.length > 0 && (
              <button
                onClick={() => setExportOpen(true)}
                aria-label={t("chat.export")}
                title={t("chat.export")}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-[var(--radius-control)] text-ink-500 hover:text-ink-900 hover:bg-surface-hover"
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
                <div className="pt-4 sm:pt-12 bg-hero-wash rounded-3xl -mx-2 px-2">
                  <h2 className="font-display text-2xl sm:text-3xl text-ink-950">
                    {isAdmin
                      ? "Spot-check your knowledge base"
                      : fullName
                      ? t("chat.greeting", { name: fullName.split(" ")[0] })
                      : t("chat.greetingAnon")}
                  </h2>
                  <p className="text-sm text-ink-500 mt-2 max-w-xl">
                    {isAdmin
                      ? "This assistant is built for your students and faculty. Ask a test question to confirm an upload is retrieved and cited correctly - admin test questions aren't counted in usage analytics."
                      : t("chat.intro", { college: collegeName ?? t("chat.introFallbackCollege") })}
                  </p>
                  {!isAdmin && (
                    <div className="mt-6">
                      <p className="text-[11px] uppercase tracking-wider text-ink-500 mb-2">{t("chat.quickActions")}</p>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_ACTIONS.map((a) => (
                          <button
                            key={a.key}
                            onClick={() => send(a.query)}
                            disabled={sending}
                            className="text-sm bg-surface hover:bg-violet-50 border border-line hover:border-violet-500 text-ink-800 px-3.5 h-9 rounded-full transition-colors disabled:opacity-50"
                          >
                            {t(a.key)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-8">
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
              {error && <ErrorBanner message={error} onRetry={input.trim() ? () => send(input) : undefined} />}
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
                {t("chat.askLabel")}
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
                placeholder={t("chat.placeholder")}
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm text-ink-900 placeholder:text-ink-400 px-2.5 py-2 outline-none"
              />
              {voice.supported && (
                <button
                  type="button"
                  onClick={() => (voice.listening ? voice.stop() : voice.start())}
                  aria-label={voice.listening ? "Stop voice input" : "Start voice input"}
                  aria-pressed={voice.listening}
                  className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-full transition-colors ${
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
                aria-label={t("chat.send")}
                className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full bg-brand text-on-navy hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
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
            <p className="max-w-3xl mx-auto text-center text-[11px] text-ink-500 mt-2 px-2">{t("chat.disclaimer")}</p>
          </div>
        </section>
      </div>
      {exportOpen && (
        <ChatExportDialog sessions={sessions} activeSession={activeSession} onClose={() => setExportOpen(false)} />
      )}
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
  onFeedback: (id: number, value: "up" | "down", reason?: FeedbackReason) => void;
}) {
  const t = useT();
  const [feedbackGiven, setFeedbackGiven] = useState<"up" | "down" | null>(null);
  const [askReason, setAskReason] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toastError("Couldn't copy to the clipboard.");
    }
  };

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-brand text-on-navy rounded-2xl rounded-br-md px-4 py-2.5 text-sm max-w-[85%] sm:max-w-[75%] whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  const lowConfidence =
    !message.abstained && typeof message.confidence === "number" && message.confidence < LOW_CONFIDENCE;

  return (
    <div className="flex gap-3">
      <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full border border-line bg-surface flex items-center justify-center">
        <MarkIcon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        {message.pending ? (
          <div className="flex items-center gap-2 text-ink-500 text-sm py-1" role="status">
            <Spinner className="w-4 h-4" />
            {t("chat.checking")}
          </div>
        ) : (
          <>
            <div className="text-[15px] text-ink-900 leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </div>

            {lowConfidence && (
              <p className="mt-2 text-xs text-seal-amber-900 bg-seal-amber-50 border border-seal-amber-100 rounded-[var(--radius-control)] px-3 py-2">
                {t("chat.lowConfidence")}
              </p>
            )}

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
                      <p className="font-medium">{t("chat.conflictTitle", { topic: c.topic })}</p>
                      <p className="mt-1">
                        {t("chat.conflictBody", { a: c.value_a, b: c.value_b })} {c.reasoning}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {message.citations && message.citations.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wider text-ink-500 mb-2">{t("chat.sources")}</p>
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

            <div className="flex flex-wrap items-center gap-2 mt-3">
              {!message.abstained && typeof message.confidence === "number" && (
                <span className="text-[11px] text-ink-500" style={{ fontFamily: "var(--font-mono)" }}>
                  {t("chat.confidence", { value: Math.round(message.confidence) })}
                </span>
              )}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={copy}
                  aria-label={t("chat.copy")}
                  title={copied ? t("chat.copied") : t("chat.copy")}
                  className="h-8 px-2 flex items-center gap-1 rounded-full text-ink-400 hover:text-ink-800 hover:bg-surface-hover text-[11px]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="11" rx="2" strokeWidth="1.6" />
                    <path d="M5 15V6a2 2 0 0 1 2-2h8" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  {copied && <span role="status">{t("chat.copied")}</span>}
                </button>
                {!message.abstained && typeof message.confidence === "number" && (
                  <>
                    <button
                      aria-label={t("chat.helpful")}
                      title={t("chat.helpful")}
                      aria-pressed={feedbackGiven === "up"}
                      onClick={() => {
                        onFeedback(message.id, "up");
                        setFeedbackGiven("up");
                        setAskReason(false);
                      }}
                      className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-surface-hover ${
                        feedbackGiven === "up" ? "text-seal-teal-700" : "text-ink-400 hover:text-ink-800"
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path d="M7 22V11l5-9 1.5 1L12 11h8l-2 11H9l-2-1Z" strokeWidth="1.6" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      aria-label={t("chat.notHelpful")}
                      title={t("chat.notHelpful")}
                      aria-pressed={feedbackGiven === "down"}
                      onClick={() => {
                        onFeedback(message.id, "down");
                        setFeedbackGiven("down");
                        setAskReason(true);
                      }}
                      className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-surface-hover ${
                        feedbackGiven === "down" ? "text-seal-coral-700" : "text-ink-400 hover:text-ink-800"
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path d="M17 2v11l-5 9-1.5-1L12 13H4l2-11h11l2 1Z" strokeWidth="1.6" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>

            {askReason && (
              <div className="mt-2" role="group" aria-label={t("chat.feedbackWhy")}>
                <p className="text-xs text-ink-500 mb-1.5">{t("chat.feedbackWhy")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {FEEDBACK_REASONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => {
                        onFeedback(message.id, "down", r);
                        setAskReason(false);
                      }}
                      className="text-xs px-3 h-8 rounded-full border border-line bg-surface hover:border-violet-500 hover:bg-violet-50 text-ink-800"
                    >
                      {t(`reason.${r}` as MessageKey)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {feedbackGiven && !askReason && (
              <p className="mt-2 text-xs text-ink-500" role="status">
                {t("chat.feedbackThanks")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
