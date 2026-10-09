import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, EmptyState, ErrorBanner, PageHeader, SkeletonList } from "@/components/ui";
import {
  api,
  ApiError,
  type DocumentOut,
  type FeedbackReason,
  type FeedbackSummary,
  type UnansweredQuestion,
} from "@/lib/api";
import { formatWhen } from "@/components/notificationUi";
import { toastError, toastSuccess } from "@/lib/toastStore";
import { useT, type MessageKey } from "@/lib/i18n";

type StatusFilter = "open" | "resolved";

const REASON_LABEL: Record<string, string> = {
  no_sources: "No matching documents",
  low_confidence: "Low confidence",
};

/**
 * What students asked that the knowledge base couldn't answer well, and how
 * they rated the answers they did get. Everything here is aggregated for the
 * admin's own college and carries no student identity.
 */
export default function AdminInsights() {
  const t = useT();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [questions, setQuestions] = useState<UnansweredQuestion[] | null>(null);
  const [feedback, setFeedback] = useState<FeedbackSummary | null>(null);
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkDoc, setLinkDoc] = useState<Record<string, string>>({});

  const load = async () => {
    setError(null);
    try {
      const [q, f, d] = await Promise.all([
        api.admin.unanswered(status),
        api.admin.feedbackSummary(),
        api.documents.list(),
      ]);
      setQuestions(q);
      setFeedback(f);
      setDocs(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load insights.");
    }
  };

  useEffect(() => {
    setQuestions(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const resolve = async (query: string) => {
    setBusy(query);
    try {
      const docId = linkDoc[query] ? Number(linkDoc[query]) : undefined;
      await api.admin.resolveUnanswered(query, docId);
      setQuestions((prev) => (prev ? prev.filter((q) => q.query !== query) : prev));
      toastSuccess("Marked as resolved.");
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't update this question.");
    } finally {
      setBusy(null);
    }
  };

  const ratio = feedback?.helpful_ratio;
  const reasonEntries = Object.entries(feedback?.reasons ?? {}) as [FeedbackReason, number][];
  const totalRated = (feedback?.helpful ?? 0) + (feedback?.not_helpful ?? 0);
  const maxReason = Math.max(1, ...reasonEntries.map(([, c]) => c));

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin command center"
        title="Questions & feedback"
        description="Questions your students asked that CampusMind AI couldn't answer well, plus how they rated its answers. Upload or publish the missing document, then mark the question resolved."
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      {/* 1. How are answers landing? One proportion bar, not three boxes. */}
      <section aria-labelledby="feedback-h" className="mb-10">
        <h2 id="feedback-h" className="flex items-center gap-2.5 text-xl font-bold text-ink-950 mb-4">
          <Node />
          How answers are landing
        </h2>
        {!feedback ? (
          !error && <SkeletonList count={1} lines={2} />
        ) : totalRated === 0 ? (
          <p className="text-sm text-ink-700 border-l-[5px] border-l-line-strong pl-3 py-1">
            No ratings yet. Helpful and not-helpful votes from students will appear here.
          </p>
        ) : (
          <div>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <p className="text-5xl font-bold text-ink-950 leading-none">
                {typeof ratio === "number" ? `${Math.round(ratio * 100)}%` : "-"}
              </p>
              <p className="data text-ink-500 pb-1">
                found helpful · {feedback.helpful} helpful · {feedback.not_helpful} not helpful
              </p>
            </div>
            <div
              role="img"
              aria-label={`${feedback.helpful} helpful and ${feedback.not_helpful} not helpful answers`}
              className="mt-4 flex h-4 w-full max-w-xl border-[1.5px] border-ink-950 rounded-[var(--radius-chip)] overflow-hidden"
            >
              <span className="bg-lamp" style={{ width: `${(feedback.helpful / totalRated) * 100}%` }} />
              <span
                className="bg-ink-950"
                style={{ width: `${(feedback.not_helpful / totalRated) * 100}%` }}
                aria-hidden="true"
              />
            </div>
            <p className="data text-ink-500 mt-1.5 flex max-w-xl justify-between">
              <span>◆ helpful</span>
              <span>■ not helpful</span>
            </p>

            {reasonEntries.length > 0 && (
              <div className="mt-6 max-w-xl">
                <h3 className="label-caps !text-ink-950 mb-2">Why answers were marked not helpful</h3>
                <ul className="border-t border-line-strong">
                  {reasonEntries
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, count]) => (
                      <li key={reason} className="flex items-center gap-3 py-2 border-b border-line text-sm">
                        <span className="w-44 shrink-0 text-ink-900">{t(`reason.${reason}` as MessageKey)}</span>
                        <span className="flex-1 h-2 bg-paper-200 rounded-[var(--radius-chip)]" aria-hidden="true">
                          <span
                            className="block h-full bg-ink-950 rounded-[var(--radius-chip)]"
                            style={{ width: `${(count / maxReason) * 100}%` }}
                          />
                        </span>
                        <span className="data text-ink-950 w-8 text-right">{count}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. What are users asking that we cannot answer? */}
      <section aria-labelledby="unanswered-h" className="mb-10">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
          <h2 id="unanswered-h" className="flex items-center gap-2.5 text-xl font-bold text-ink-950">
            <Node />
            Unanswered questions
          </h2>
          <div role="group" aria-label="Filter by status" className="flex border-b border-line-strong">
            {(["open", "resolved"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
                className={`min-h-11 px-4 text-sm capitalize transition-colors ${
                  status === s ? "lamp-under font-bold text-ink-950" : "text-ink-700 hover:text-ink-950"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {!error && questions === null && <SkeletonList count={3} lines={2} />}
        {questions && questions.length === 0 && (
          <EmptyState
            title={status === "open" ? "Nothing waiting" : "No resolved questions yet"}
            body="Questions the assistant could not answer from your documents will be grouped here."
          />
        )}

        <ul className="border-t border-line-strong mt-3">
          {questions?.map((q) => (
            <li key={q.query} className="flex gap-4 py-5 border-b border-line">
              <div
                className="w-12 shrink-0 self-start text-center border-[1.5px] border-ink-950 rounded-[var(--radius-control)] py-1 leading-none bg-surface"
                role="img"
                aria-label={`Asked ${q.frequency} times`}
              >
                <div className="data !text-[10px] uppercase tracking-wider text-ink-500">asked</div>
                <div className="data !text-xl font-bold text-ink-950 mt-0.5">{q.frequency}</div>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-ink-950 break-words">{q.query}</h3>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {q.reason && <Badge tone="amber">{REASON_LABEL[q.reason] ?? q.reason}</Badge>}
                  {q.linked_document && <Badge tone="teal">Linked: {q.linked_document.title}</Badge>}
                </div>
                <p className="data text-ink-500 mt-2">
                  Last asked {formatWhen(q.last_asked)}
                  {typeof q.avg_confidence === "number" ? ` · average confidence ${Math.round(q.avg_confidence)}%` : ""}
                </p>
                {status === "open" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`doc-${q.query}`}>
                      Link a document that answers this
                    </label>
                    <select
                      id={`doc-${q.query}`}
                      value={linkDoc[q.query] ?? ""}
                      onChange={(e) => setLinkDoc((prev) => ({ ...prev, [q.query]: e.target.value }))}
                      className="min-h-11 text-sm border border-line-strong rounded-[var(--radius-control)] px-2 bg-surface text-ink-900 max-w-full"
                    >
                      <option value="">No linked document</option>
                      {docs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                    <Button variant="secondary" disabled={busy === q.query} onClick={() => resolve(q.query)}>
                      Mark resolved
                    </Button>
                    <Link
                      to="/admin/notifications"
                      className="min-h-11 inline-flex items-center px-2 text-sm font-semibold text-violet-600 underline underline-offset-4 decoration-2"
                    >
                      Publish an announcement
                    </Link>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 3. Which answers failed, in the user's own words? */}
      {feedback && feedback.recent_not_helpful.length > 0 && (
        <section aria-labelledby="recent-h">
          <h2 id="recent-h" className="flex items-center gap-2.5 text-xl font-bold text-ink-950 mb-3">
            <Node />
            Recent answers marked not helpful
          </h2>
          <ul className="border-t border-line-strong">
            {feedback.recent_not_helpful.map((f) => (
              <li key={f.message_id} className="py-4 border-b border-line border-l-[5px] border-l-ink-950 pl-4">
                <div className="flex flex-wrap items-center gap-2">
                  {f.reason && <Badge tone="coral">{t(`reason.${f.reason}` as MessageKey)}</Badge>}
                  {typeof f.confidence === "number" && <Badge>Confidence {Math.round(f.confidence)}%</Badge>}
                  <span className="data text-ink-500">{formatWhen(f.created_at)}</span>
                </div>
                <p className="text-sm text-ink-800 mt-2 whitespace-pre-line break-words">{f.answer_excerpt}</p>
                {f.note && <p className="text-sm text-ink-700 mt-2 italic break-words">"{f.note}"</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}

function Node() {
  return <span aria-hidden="true" className="w-2.5 h-2.5 rotate-45 bg-lamp outline outline-1 outline-ink-950 shrink-0" />;
}
