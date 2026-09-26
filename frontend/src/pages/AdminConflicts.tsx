import { useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, Card, ErrorBanner, PageHeader, SkeletonList, EmptyState } from "@/components/ui";
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
        <div className="flex flex-col gap-4">
          {conflicts.map((c) => {
            const docA = docsById[c.document_a_id];
            const docB = docsById[c.document_b_id];
            return (
              <Card key={c.id} className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Badge tone="amber">Conflict</Badge>
                  <h3 className="font-medium text-ink-900 capitalize">{c.topic}</h3>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <ConflictSide
                    label="Source A"
                    title={docA?.title ?? `Document #${c.document_a_id}`}
                    value={c.value_a}
                    suggested={c.suggested_authoritative_id === c.document_a_id}
                    effectiveDate={docA?.effective_date}
                    onKeep={() => resolve(c.id, c.document_a_id)}
                    busy={resolvingId === c.id}
                  />
                  <ConflictSide
                    label="Source B"
                    title={docB?.title ?? `Document #${c.document_b_id}`}
                    value={c.value_b}
                    suggested={c.suggested_authoritative_id === c.document_b_id}
                    effectiveDate={docB?.effective_date}
                    onKeep={() => resolve(c.id, c.document_b_id)}
                    busy={resolvingId === c.id}
                  />
                </div>
                <p className="text-sm text-ink-500 mt-4 bg-paper-100 rounded-[var(--radius-control)] px-4 py-3">
                  {c.reasoning}
                </p>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional resolution note for the record..."
                  aria-label="Resolution note"
                  className="w-full mt-3 h-10 text-sm bg-surface text-ink-900 placeholder:text-ink-400 border border-line-strong rounded-[var(--radius-control)] px-3 outline-none focus:border-violet-500"
                />
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function ConflictSide({
  label,
  title,
  value,
  suggested,
  effectiveDate,
  onKeep,
  busy,
}: {
  label: string;
  title: string;
  value: string;
  suggested: boolean;
  effectiveDate?: string | null;
  onKeep: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-control)] border p-4 ${
        suggested ? "border-seal-teal-600 bg-seal-teal-50" : "border-line"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-500 uppercase tracking-wide">{label}</span>
        {suggested && <Badge tone="teal">Suggested</Badge>}
      </div>
      <p className="text-sm font-medium text-ink-900 mt-1.5">{title}</p>
      <p className="text-2xl font-display text-ink-950 mt-1">{value}</p>
      {effectiveDate && (
        <p className="text-xs text-ink-400 mt-1">Effective {new Date(effectiveDate).toLocaleDateString()}</p>
      )}
      <Button variant="secondary" className="w-full mt-3 !py-2 text-xs" onClick={onKeep} disabled={busy}>
        Keep this as authoritative
      </Button>
    </div>
  );
}
