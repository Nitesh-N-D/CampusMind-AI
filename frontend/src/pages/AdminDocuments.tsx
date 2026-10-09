import { useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, ErrorBanner, PageHeader, SkeletonList, EmptyState } from "@/components/ui";
import { TrustMeter } from "@/components/Seal";
import { DocGlyph, StatusTag, shortDate, type DocStatus } from "@/components/campus";
import { api, ApiError, type DocumentOut } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/toastStore";
import { UploadForm } from "@/pages/DocumentsUploadForm";
import { DetectedEvents } from "@/components/DetectedEvents";

const FILE_TYPE_LABEL: Record<DocumentOut["file_type"], string> = {
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  presentation: "PowerPoint",
  csv: "CSV",
  text: "Text",
  image: "Image",
  unknown: "File",
};

const DOC_STATUS: Record<string, DocStatus> = {
  ready: "current",
  processing: "processing",
  uploaded: "processing",
  failed: "failed",
  archived: "archived",
};

export default function AdminDocuments() {
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
        eyebrow="Admin"
        title="Documents"
        description="Every official source CampusMind AI is allowed to answer from, with its trust score and status. Students and faculty only see these through cited chat answers."
        actions={<Button onClick={() => setShowUpload((v) => !v)}>{showUpload ? "Close" : "Upload documents"}</Button>}
      />

      {showUpload && (
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
          title="Upload your first official document"
          body="Start with an academic regulation or the current exam schedule - CampusMind AI can only answer from what's uploaded here. PDF, Word, Excel, PowerPoint, CSV, text, and image files are supported."
          action={<Button onClick={() => setShowUpload(true)}>Upload documents</Button>}
        />
      )}

      {!loading && docs && docs.length > 0 && (
        <div className="border-t border-line-strong">
          {docs.map((doc) => {
            const status = DOC_STATUS[doc.status] ?? "draft";
            const unit =
              doc.file_type === "pdf"
                ? "page"
                : doc.file_type === "excel"
                  ? "sheet"
                  : doc.file_type === "presentation"
                    ? "slide"
                    : "section";
            return (
              <article key={doc.id} className="py-5 border-b border-line flex flex-col sm:flex-row gap-4">
                <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:w-24 shrink-0">
                  <DocGlyph version={doc.version} status={status} />
                  <TrustMeter score={doc.trust_score} level={doc.trust_level} size="md" showLabel />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-ink-950 break-words min-w-0">{doc.title}</h3>
                    <StatusTag status={status} />
                    {doc.is_verified && <Badge tone="teal">Admin verified</Badge>}
                    {doc.is_demo_data && <Badge tone="violet">Demo data</Badge>}
                  </div>
                  <p className="data text-ink-500 mt-2 break-words">
                    {FILE_TYPE_LABEL[doc.file_type]} · {doc.document_type.replace("_", " ")}
                    {doc.department ? ` · ${doc.department}` : ""}
                    {doc.academic_year ? ` · ${doc.academic_year}` : ""} · v{doc.version} · {doc.page_count} {unit}
                    {doc.page_count === 1 ? "" : "s"}
                  </p>
                  {doc.effective_date && (
                    <p className="data text-ink-500 mt-1">Effective {shortDate(doc.effective_date)}</p>
                  )}
                  {doc.processing_error && (
                    <p className="text-xs text-seal-coral-700 mt-1.5">{doc.processing_error}</p>
                  )}
                  <DetectedEvents doc={doc} />
                </div>
                <div className="flex flex-wrap sm:flex-col gap-2 shrink-0">
                  {!doc.is_verified && (
                    <Button variant="secondary" className="text-xs" onClick={() => handleVerify(doc.id)}>
                      Mark verified
                    </Button>
                  )}
                  <Button variant="danger" className="text-xs" onClick={() => handleDelete(doc.id)}>
                    Delete
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

