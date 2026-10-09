import { useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Button, ErrorBanner, PageHeader, SkeletonList, EmptyState } from "@/components/ui";
import { Supersession, shortDate } from "@/components/campus";
import { api, ApiError, type ConflictRecord, type DocumentOut } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/toastStore";

export default function AdminConflicts() {
  const [conflicts, setConflicts] = useState<ConflictRecord[] | null>(null);
  const [docsById, setDocsById] = useState<Record<number, DocumentOut>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [conflictList, docs] = await Promise.all([api.admin.conflicts(), api.documents.list()]);
      setConflicts(conflictList);
      setDocsById(Object.fromEntries(docs.map((d) => [d.id, d])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load conflicts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resolve = async (conflictId: number, keepDocId: number) => {
    setResolvingId(conflictId);
    try {
      await api.admin.resolveConflict(conflictId, keepDocId, note || undefined);
      setConflicts((prev) => (prev ? prev.filter((c) => c.id !== conflictId) : prev));
      setNote("");
      toastSuccess("Conflict resolved.");
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't resolve this conflict.");
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin command center"
        title="Conflicting sources"
        description="CampusMind AI never silently picks a side when two official documents disagree. Review each one and decide which stays authoritative - the other is archived automatically."
      />

      {loading && <SkeletonList count={4} lines={2} />}

      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && !error && conflicts?.length === 0 && (
        <EmptyState
          title="No open conflicts"
          body="When two official documents assert different values for the same regulated topic - like attendance percentage or fees - they'll show up here for review."
        />
      )}

      {!loading && conflicts && conflicts.length > 0 && (
        <div className="flex flex-col gap-8">
          {conflicts.map((c) => {
            const docA = docsById[c.document_a_id];
            const docB = docsById[c.document_b_id];
            const titleA = docA?.title ?? `Document #${c.document_a_id}`;
            const titleB = docB?.title ?? `Document #${c.document_b_id}`;
            const facts = (d: DocumentOut | undefined) =>
              d
                ? [`v${d.version}`, d.effective_date ? `effective ${shortDate(d.effective_date)}` : null]
                    .filter(Boolean)
                    .join(" · ")
                : "";
            const suggestedA = c.suggested_authoritative_id === c.document_a_id;
            const suggestedB = c.suggested_authoritative_id === c.document_b_id;
            return (
              <article key={c.id} aria-label={`Conflict: ${c.topic}`}>
                <Supersession
                  topic={c.topic}
                  reasoning={c.reasoning}
                  lanes={[
                    {
                      tag: suggestedA ? "Source A · Suggested" : "Source A",
                      value: c.value_a,
                      source: [titleA, facts(docA)].filter(Boolean).join(" · "),
                    },
                    {
                      tag: suggestedB ? "Source B · Suggested" : "Source B",
                      value: c.value_b,
                      source: [titleB, facts(docB)].filter(Boolean).join(" · "),
                    },
                  ]}
                />
                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  <Button
                    variant={suggestedA ? "primary" : "secondary"}
                    onClick={() => resolve(c.id, c.document_a_id)}
                    disabled={resolvingId === c.id}
                  >
                    Keep Source A as authoritative
                  </Button>
                  <Button
                    variant={suggestedB ? "primary" : "secondary"}
                    onClick={() => resolve(c.id, c.document_b_id)}
                    disabled={resolvingId === c.id}
                  >
                    Keep Source B as authoritative
                  </Button>
                </div>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional resolution note for the record..."
                  aria-label={`Resolution note for ${c.topic}`}
                  className="w-full mt-3 min-h-11 text-sm bg-surface text-ink-900 placeholder:text-ink-500 border border-line-strong rounded-[var(--radius-control)] px-3 outline-none focus:border-ink-950"
                />
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
