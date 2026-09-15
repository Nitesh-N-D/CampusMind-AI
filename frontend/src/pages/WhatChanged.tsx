import { useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Card, EmptyState, ErrorBanner, PageHeader, SkeletonList } from "@/components/ui";
import { api, ApiError, type ChangeLog } from "@/lib/api";

export default function WhatChanged() {
  const [changes, setChanges] = useState<ChangeLog[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setChanges(await api.documents.changes());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load recent changes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Change intelligence"
        title="What changed?"
        description="Whenever an admin uploads a document that replaces an older one, CampusMind AI diffs the two and explains the practical impact - so you never miss a regulation update."
      />

      {loading && <SkeletonList count={3} lines={3} />}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && !error && changes?.length === 0 && (
        <EmptyState
          title="No changes yet"
          body="When your admin uploads a new version of a document and marks which one it supersedes, the comparison will appear here automatically."
        />
      )}

      {!loading && changes && changes.length > 0 && (
        <div className="flex flex-col gap-4">
          {changes.map((c) => (
            <Card key={c.id} className="p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="font-medium text-ink-900 capitalize">{c.topic.replace(/_/g, " ")}</h3>
                <span className="text-xs text-ink-400" style={{ fontFamily: "var(--font-mono)" }}>
                  {new Date(c.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>

              <div className="grid sm:grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="rounded-[var(--radius-control)] border border-seal-coral-100 bg-seal-coral-50 p-4">
                  <p className="text-xs font-medium text-seal-coral-900 uppercase tracking-wide mb-1">
                    Old - {c.old_document_title}
                  </p>
                  <p className="font-display text-xl text-ink-950">{c.old_value ?? "-"}</p>
                </div>

                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  className="text-ink-300 mx-auto rotate-90 sm:rotate-0"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>

                <div className="rounded-[var(--radius-control)] border border-seal-teal-100 bg-seal-teal-50 p-4">
                  <p className="text-xs font-medium text-seal-teal-900 uppercase tracking-wide mb-1">
                    New - {c.new_document_title}
                  </p>
                  <p className="font-display text-xl text-ink-950">{c.new_value ?? "-"}</p>
                </div>
              </div>

              {c.impact_summary && (
                <p className="text-sm text-ink-600 mt-4 bg-paper-100 rounded-[var(--radius-control)] px-4 py-3">
                  {c.impact_summary}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
