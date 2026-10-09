import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { ErrorBanner, PageHeader, Skeleton, Badge } from "@/components/ui";
import { TrustMeter, type TrustLevel } from "@/components/Seal";
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
            <Skeleton className="w-36 h-36" />
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
  const toneText = tone === "teal" ? "Healthy" : tone === "amber" ? "Needs attention" : "Action required";
  const healthLevel: TrustLevel =
    health.health_score >= 85 ? "very_high" : health.health_score >= 70 ? "high" : health.health_score >= 45 ? "medium" : "low";
  const attention: { to: string; label: string; count: number }[] = [
    { to: "/admin/conflicts", label: "Documents in an unresolved conflict", count: health.conflicting },
    { to: "/admin/documents", label: "Documents not yet processed", count: health.unprocessed },
    { to: "/admin/documents", label: "Outdated documents", count: health.outdated },
    { to: "/admin/insights", label: "Unanswered questions", count: analytics.unanswered_questions },
  ].filter((a) => a.count > 0);
  const helpful =
    typeof analytics.feedback_helpful_ratio === "number"
      ? `${Math.round(analytics.feedback_helpful_ratio * 100)}%`
      : "-";

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title="Knowledge base health"
        description="How verified, current and conflict-free your college's document set is right now."
      />

      <section aria-labelledby="attention" className="mb-2">
        <h2 id="attention" className="label-caps !text-ink-950 mb-2">
          Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="text-sm text-ink-700 border-l-[5px] border-l-lamp pl-3 py-1">Nothing needs action right now.</p>
        ) : (
          <ul className="border-t border-line-strong">
            {attention.map((a) => (
              <li key={a.label} className="border-b border-line">
                <Link
                  to={a.to}
                  className="flex items-center gap-4 min-h-12 py-2 pr-1 hover:bg-surface-hover"
                >
                  <span className="data !text-2xl font-semibold text-ink-950 w-12 text-right">{a.count}</span>
                  <span className="flex-1 text-sm font-medium text-ink-900">{a.label}</span>
                  <span className="text-sm text-ink-700 shrink-0" aria-hidden="true">Review &rarr;</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Group title="Campus knowledge" action={{ to: "/admin/documents", label: "Manage documents" }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">
          <span className="text-5xl font-bold text-ink-950 leading-none">{Math.round(health.health_score)}</span>
          <span className="data text-ink-500">/ 100</span>
          <TrustMeter level={healthLevel} score={health.health_score} size="lg" showLabel showScore={false} />
          <Badge tone={tone}>{toneText}</Badge>
        </div>
        <Stats
          rows={[
            ["Documents indexed", health.documents_indexed],
            ["Verified", health.verified],
            ["Outdated", health.outdated],
            ["Unprocessed", health.unprocessed],
          ]}
        />
        <h3 className="label-caps mt-6 mb-2">Recent uploads</h3>
        {analytics.recent_uploads.length === 0 ? (
          <p className="text-sm text-ink-500">No documents uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {analytics.recent_uploads.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-ink-800 truncate min-w-0">{d.title}</span>
                <Badge tone={d.status === "ready" ? "teal" : d.status === "archived" ? "neutral" : "amber"}>
                  {d.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="AI quality" action={{ to: "/admin/insights", label: "Review questions and feedback" }}>
        <Stats
          rows={[
            ["Conflicting documents", health.conflicting],
            ["Low-confidence topics", health.low_confidence_topics],
            ["Unanswered questions", analytics.unanswered_questions],
            ["Low-confidence answers", analytics.low_confidence_responses],
            ["Rated helpful", helpful],
          ]}
        />
        {health.conflicting > 0 && (
          <Link
            to="/admin/conflicts"
            className="mt-4 flex items-center justify-between gap-3 border-l-[5px] border-seal-amber-600 bg-seal-amber-50 text-seal-amber-900 px-4 py-3 text-sm hover:bg-seal-amber-100"
          >
            <span className="font-medium">
              {health.conflicting} document{health.conflicting === 1 ? "" : "s"} in an unresolved conflict
            </span>
            <span className="shrink-0">Review conflicts &rarr;</span>
          </Link>
        )}
      </Group>

      <Group title="Campus activity (last 30 days)">
        <Stats
          rows={[
            ["Questions answered", analytics.total_questions_answered],
            ["Active users", analytics.active_users_30d],
            ["Reminders pending", analytics.reminders_pending],
          ]}
        />
        <h3 className="label-caps mt-6 mb-2">Most asked</h3>
        {analytics.top_queries.length === 0 ? (
          <p className="text-sm text-ink-500">No questions logged yet.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {analytics.top_queries.map((q) => (
              <li key={q.query} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-ink-800 truncate min-w-0">{q.query}</span>
                <span className="data text-ink-500 shrink-0">{q.count}x</span>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </AppShell>
  );
}

function Group({
  title,
  action,
  children,
}: {
  title: string;
  action?: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="py-6 border-b border-line last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="flex items-center gap-2.5 text-xl font-bold text-ink-950">
          <span aria-hidden="true" className="w-2.5 h-2.5 rotate-45 bg-lamp outline outline-1 outline-ink-950 shrink-0" />
          {title}
        </h2>
        {action && (
          <Link
            to={action.to}
            className="inline-flex items-center min-h-11 px-3 border border-line-strong rounded-[var(--radius-control)] text-sm font-medium text-ink-900 hover:bg-surface-hover"
          >
            {action.label} &rarr;
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Stats({ rows }: { rows: [string, number | string][] }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
      {rows.map(([k, v]) => (
        <div key={k} className="border-l-[3px] border-ink-950 pl-3">
          <dt className="text-xs text-ink-500">{k}</dt>
          <dd className="data !text-2xl font-semibold text-ink-950">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
