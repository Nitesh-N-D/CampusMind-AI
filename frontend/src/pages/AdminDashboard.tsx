import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { Card, ErrorBanner, PageHeader, Skeleton, Badge } from "@/components/ui";
import { api, ApiError, type Analytics, type KnowledgeHealth } from "@/lib/api";

function scoreTone(score: number): "teal" | "amber" | "coral" {
  if (score >= 75) return "teal";
  if (score >= 45) return "amber";
  return "coral";
}

export default function AdminDashboard() {
  const [health, setHealth] = useState<KnowledgeHealth | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, a] = await Promise.all([api.admin.knowledgeHealth(), api.admin.analytics()]);
      setHealth(h);
      setAnalytics(a);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the admin dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="mb-8">
          <Skeleton className="h-3 w-32 mb-3" />
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 mb-10">
          <div className="bg-surface border border-line rounded-[var(--radius-card)] p-7 flex flex-col items-center justify-center gap-4">
            <Skeleton className="w-36 h-36 rounded-full" />
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface border border-line rounded-[var(--radius-card)] p-5">
                <Skeleton className="h-3 w-16 mb-3" />
                <Skeleton className="h-7 w-10" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[0, 1].map((i) => (
            <div key={i} className="bg-surface border border-line rounded-[var(--radius-card)] p-6">
              <Skeleton className="h-4 w-40 mb-5" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  if (error || !health || !analytics) {
    return (
      <AppShell>
        <ErrorBanner message={error ?? "Something went wrong."} onRetry={load} />
      </AppShell>
    );
  }

  const tone = scoreTone(health.health_score);
  const metrics = [
    { label: "Documents indexed", value: health.documents_indexed },
    { label: "Verified", value: health.verified },
    { label: "Outdated", value: health.outdated },
    { label: "Conflicting", value: health.conflicting },
    { label: "Unprocessed", value: health.unprocessed },
    { label: "Low-confidence topics", value: health.low_confidence_topics },
  ];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin command center"
        title="Knowledge base health"
        description="A single score summarizing how verified, current, and conflict-free your college's document set is right now."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 mb-10">
        <Card className="p-7 flex flex-col items-center justify-center text-center">
          <div className="relative w-36 h-36">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-paper-200)" strokeWidth="10" />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke={
                  tone === "teal"
                    ? "var(--color-seal-teal-600)"
                    : tone === "amber"
                    ? "var(--color-seal-amber-600)"
                    : "var(--color-seal-coral-600)"
                }
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${(health.health_score / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-4xl text-ink-950">{Math.round(health.health_score)}</span>
              <span className="text-xs text-ink-400">out of 100</span>
            </div>
          </div>
          <Badge tone={tone}>
            {tone === "teal" ? "Healthy" : tone === "amber" ? "Needs attention" : "Action required"}
          </Badge>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {metrics.map((m) => (
            <Card key={m.label} className="p-5">
              <p className="text-xs text-ink-500">{m.label}</p>
              <p className="font-display text-2xl text-ink-950 mt-1">{m.value}</p>
            </Card>
          ))}
        </div>
      </div>

      {health.conflicting > 0 && (
        <Link
          to="/admin/conflicts"
          className="flex items-center justify-between bg-seal-amber-50 border border-seal-amber-100 text-seal-amber-900 rounded-[var(--radius-card)] px-5 py-4 mb-10 hover:border-seal-amber-600 transition-colors"
        >
          <span className="text-sm font-medium">
            {health.conflicting} document{health.conflicting === 1 ? "" : "s"} involved in an unresolved conflict
          </span>
          <span className="text-sm">Review &rarr;</span>
        </Link>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="font-medium text-ink-900 mb-1">Usage, last 30 days</h2>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div>
              <p className="font-display text-2xl text-ink-950">{analytics.total_questions_answered}</p>
              <p className="text-xs text-ink-500 mt-1">Questions answered</p>
            </div>
            <div>
              <p className="font-display text-2xl text-ink-950">{analytics.unanswered_questions}</p>
              <p className="text-xs text-ink-500 mt-1">Unanswered</p>
            </div>
            <div>
              <p className="font-display text-2xl text-ink-950">{analytics.low_confidence_responses}</p>
              <p className="text-xs text-ink-500 mt-1">Low confidence</p>
            </div>
          </div>
          <h3 className="text-sm font-medium text-ink-800 mt-6 mb-3">Most asked</h3>
          {analytics.top_queries.length === 0 ? (
            <p className="text-sm text-ink-400">No questions logged yet.</p>
          ) : (
            <ul className="space-y-2">
              {analytics.top_queries.map((q) => (
                <li key={q.query} className="flex items-center justify-between text-sm">
                  <span className="text-ink-700 truncate min-w-0 pr-3">{q.query}</span>
                  <span className="text-ink-400 shrink-0" style={{ fontFamily: "var(--font-mono)" }}>
                    {q.count}x
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="font-medium text-ink-900 mb-4">Recent uploads</h2>
          {analytics.recent_uploads.length === 0 ? (
            <p className="text-sm text-ink-400">No documents uploaded yet.</p>
          ) : (
            <ul className="space-y-3">
              {analytics.recent_uploads.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span className="text-ink-700 truncate min-w-0 pr-3">{d.title}</span>
                  <Badge tone={d.status === "ready" ? "teal" : d.status === "archived" ? "neutral" : "amber"}>
                    {d.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/admin/documents"
            className="inline-block mt-5 text-sm font-medium text-violet-600 hover:underline"
          >
            Manage all documents &rarr;
          </Link>
        </Card>
      </div>
    </AppShell>
  );
}
