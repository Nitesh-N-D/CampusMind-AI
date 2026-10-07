import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, SkeletonList } from "@/components/ui";
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

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin command center"
        title="Questions & feedback"
        description="Questions your students asked that CampusMind AI couldn't answer well, plus how they rated its answers. Upload or publish the missing document, then mark the question resolved."
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <Card className="p-5">
          <p className="text-xs text-ink-500">Helpful</p>
          <p className="font-display text-2xl text-ink-950 mt-1">{feedback?.helpful ?? "-"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-ink-500">Not helpful</p>
          <p className="font-display text-2xl text-ink-950 mt-1">{feedback?.not_helpful ?? "-"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-ink-500">Helpful rate</p>
          <p className="font-display text-2xl text-ink-950 mt-1">
            {typeof ratio === "number" ? `${Math.round(ratio * 100)}%` : "No ratings yet"}
          </p>
        </Card>
      </div>

      {reasonEntries.length > 0 && (
        <section aria-labelledby="reasons-h" className="mb-8">
          <h2 id="reasons-h" className="font-display text-lg text-ink-900 mb-3">
            Why answers were marked not helpful
          </h2>
          <div className="flex flex-wrap gap-2">
            {reasonEntries.map(([reason, count]) => (
              <Badge key={reason}>
                {t(`reason.${reason}` as MessageKey)}: {count}
              </Badge>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="unanswered-h">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 id="unanswered-h" className="font-display text-lg text-ink-900">
            Unanswered questions
          </h2>
          <div role="group" aria-label="Filter by status" className="inline-flex gap-1">
            {(["open", "resolved"] as StatusFilter[]).map((s) => (
              <Button
                key={s}
                variant={status === s ? "secondary" : "ghost"}
                aria-pressed={status === s}
                className="!py-1.5 !px-3 capitalize"
                onClick={() => setStatus(s)}
              >
                {s}
              </Button>
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

        <div className="grid gap-3">
          {questions?.map((q) => (
            <Card key={q.query} className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-ink-900 font-medium break-words min-w-0">{q.query}</h3>
                <Badge>Asked {q.frequency}x</Badge>
                {q.reason && <Badge tone="amber">{REASON_LABEL[q.reason] ?? q.reason}</Badge>}
                {q.linked_document && <Badge tone="teal">Linked: {q.linked_document.title}</Badge>}
              </div>
              <p className="text-xs text-ink-500 mt-2">
                Last asked {formatWhen(q.last_asked)}
                {typeof q.avg_confidence === "number" ? ` - average confidence ${Math.round(q.avg_confidence)}%` : ""}
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
                    className="h-9 text-sm border border-line-strong rounded-[var(--radius-control)] px-2 bg-surface text-ink-800 max-w-full"
                  >
                    <option value="">No linked document</option>
                    {docs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" className="!py-1.5 !px-3" disabled={busy === q.query} onClick={() => resolve(q.query)}>
                    Mark resolved
                  </Button>
                  <Link
                    to="/admin/notifications"
                    className="text-sm text-violet-600 hover:underline px-2 py-1.5"
                  >
                    Publish an announcement
                  </Link>
                </div>
              )}
            </Card>
          ))}
        </div>
      </section>

      {feedback && feedback.recent_not_helpful.length > 0 && (
        <section aria-labelledby="recent-h" className="mt-10">
          <h2 id="recent-h" className="font-display text-lg text-ink-900 mb-3">
            Recent answers marked not helpful
          </h2>
          <div className="grid gap-3">
            {feedback.recent_not_helpful.map((f) => (
              <Card key={f.message_id} className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {f.reason && <Badge tone="coral">{t(`reason.${f.reason}` as MessageKey)}</Badge>}
                  {typeof f.confidence === "number" && <Badge>Confidence {Math.round(f.confidence)}%</Badge>}
                  <span className="text-xs text-ink-500">{formatWhen(f.created_at)}</span>
                </div>
                <p className="text-sm text-ink-700 mt-2 whitespace-pre-line break-words">{f.answer_excerpt}</p>
                {f.note && <p className="text-sm text-ink-500 mt-2 italic break-words">"{f.note}"</p>}
              </Card>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
