import { useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, Card, ErrorBanner, PageHeader, SkeletonList, EmptyState } from "@/components/ui";
import { Seal } from "@/components/Seal";
import { api, ApiError, type DocumentOut } from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";
import { toastError, toastSuccess } from "@/lib/toastStore";
import { UploadForm } from "@/pages/DocumentsUploadForm";

const STATUS_TONE: Record<string, "neutral" | "teal" | "amber" | "coral"> = {
  ready: "teal",
  processing: "amber",
  uploaded: "amber",
  failed: "coral",
  archived: "neutral",
};

export default function Documents() {
  const role = useAuthStore((s) => s.role);
  const [docs, setDocs] = useState<DocumentOut[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDocs(await api.documents.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load documents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this document and its indexed content? This can't be undone.")) return;
    try {
      await api.documents.remove(id);
      setDocs((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
      toastSuccess("Document removed.");
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't remove this document.");
    }
  };

  const handleVerify = async (id: number) => {
    try {
      const updated = await api.documents.verify(id);
      setDocs((prev) => (prev ? prev.map((d) => (d.id === id ? updated : d)) : prev));
      toastSuccess("Document marked verified.");
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't verify this document.");
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Knowledge base"
        title="Documents"
        description="Every official source CampusMind AI is allowed to answer from, with its current trust score and status."
        actions={
          role === "admin" && (
            <Button onClick={() => setShowUpload((v) => !v)}>{showUpload ? "Close" : "Upload document"}</Button>
          )
        }
      />

      {showUpload && role === "admin" && (
        <UploadForm
          existingDocs={docs ?? []}
          onUploaded={(doc) => {
            setDocs((prev) => (prev ? [doc, ...prev] : [doc]));
          }}
        />
      )}

      {loading && <SkeletonList count={4} lines={2} />}

      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && !error && docs?.length === 0 && (
        <EmptyState
          title={role === "admin" ? "Upload your first official document" : "No documents yet"}
          body={
            role === "admin"
              ? "Start with an academic regulation or the current exam schedule - CampusMind AI can only answer from what's uploaded here."
              : "Once your admin uploads official documents, they'll appear here and become searchable in chat."
          }
          action={
            role === "admin" && (
              <Button onClick={() => setShowUpload(true)}>Upload document</Button>
            )
          }
        />
      )}

      {!loading && docs && docs.length > 0 && (
        <div className="grid gap-3">
          {docs.map((doc) => (
            <Card key={doc.id} className="p-5 flex flex-col sm:flex-row gap-4">
              <Seal score={doc.trust_score} level={doc.trust_level} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-ink-900">{doc.title}</h3>
                  <Badge tone={STATUS_TONE[doc.status] ?? "neutral"}>{doc.status}</Badge>
                  {doc.is_verified && <Badge tone="teal">Admin verified</Badge>}
                  {doc.is_demo_data && <Badge tone="violet">Demo data</Badge>}
                </div>
                <p className="text-xs text-ink-400 mt-2" style={{ fontFamily: "var(--font-mono)" }}>
                  {doc.document_type.replace("_", " ")}
                  {doc.department ? ` - ${doc.department}` : ""}
                  {doc.academic_year ? ` - ${doc.academic_year}` : ""}
                  {" - v"}
                  {doc.version} - {doc.page_count} page{doc.page_count === 1 ? "" : "s"}
                </p>
                {doc.effective_date && (
                  <p className="text-xs text-ink-400 mt-1">
                    Effective {new Date(doc.effective_date).toLocaleDateString()}
                  </p>
                )}
                {doc.processing_error && (
                  <p className="text-xs text-seal-coral-700 mt-1">{doc.processing_error}</p>
                )}
              </div>
              {role === "admin" && (
                <div className="flex sm:flex-col gap-2 shrink-0">
                  {!doc.is_verified && (
                    <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => handleVerify(doc.id)}>
                      Mark verified
                    </Button>
                  )}
                  <Button variant="danger" className="!py-1.5 text-xs" onClick={() => handleDelete(doc.id)}>
                    Delete
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}

