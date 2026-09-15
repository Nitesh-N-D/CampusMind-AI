import { useRef, useState, type DragEvent } from "react";
import { Badge, Button, Card, ErrorBanner, Input, Select, Spinner } from "@/components/ui";
import { api, ApiError, type DocumentOut } from "@/lib/api";
import { toastSuccess } from "@/lib/toastStore";

const DOC_TYPES = [
  { value: "regulation", label: "Academic regulation" },
  { value: "circular", label: "Circular" },
  { value: "timetable", label: "Timetable" },
  { value: "exam_schedule", label: "Exam schedule" },
  { value: "fee_notice", label: "Fee notice" },
  { value: "placement_notice", label: "Placement notice" },
  { value: "faculty_info", label: "Faculty information" },
  { value: "event_notice", label: "Event notice" },
  { value: "general_notice", label: "General notice" },
];

type FileStatus = "queued" | "uploading" | "done" | "failed";

interface QueuedFile {
  id: string;
  file: File;
  title: string;
  status: FileStatus;
  error?: string;
}

function titleFromFilename(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function UploadForm({
  existingDocs,
  onUploaded,
}: {
  existingDocs: DocumentOut[];
  onUploaded: (doc: DocumentOut) => void;
}) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [documentType, setDocumentType] = useState("regulation");
  const [department, setDepartment] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const pdfFiles = Array.from(files).filter((f) => f.type === "application/pdf");
    if (pdfFiles.length === 0) {
      setError("Only PDF files are accepted.");
      return;
    }
    setError(null);
    setQueue((prev) => [
      ...prev,
      ...pdfFiles.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        title: titleFromFilename(file.name),
        status: "queued" as FileStatus,
      })),
    ]);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const removeFromQueue = (id: string) => setQueue((prev) => prev.filter((f) => f.id !== id));

  const updateTitle = (id: string, title: string) =>
    setQueue((prev) => prev.map((f) => (f.id === id ? { ...f, title } : f)));

  const uploadAll = async () => {
    if (queue.length === 0) {
      setError("Add at least one PDF to upload.");
      return;
    }
    if (queue.some((f) => !f.title.trim())) {
      setError("Every file needs a title before uploading.");
      return;
    }
    setError(null);
    setUploading(true);

    // Sequential, not parallel - this avoids hammering a free-tier AI/
    // embedding provider with a burst of concurrent requests, and keeps
    // per-file progress genuinely readable rather than a jumbled race.
    let successCount = 0;
    for (const item of queue) {
      setQueue((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "uploading" } : f)));
      try {
        const form = new FormData();
        form.append("file", item.file);
        form.append("title", item.title.trim());
        form.append("document_type", documentType);
        if (department) form.append("department", department);
        if (academicYear) form.append("academic_year", academicYear);
        if (effectiveDate) form.append("effective_date", effectiveDate);
        if (queue.length === 1 && supersedes) form.append("supersedes_id", supersedes);
        form.append("is_official", "true");
        const doc = await api.documents.upload(form);
        setQueue((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "done" } : f)));
        onUploaded(doc);
        successCount += 1;
      } catch (err) {
        setQueue((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? {
                  ...f,
                  status: "failed",
                  error: err instanceof ApiError ? err.message : "Upload failed.",
                }
              : f
          )
        );
      }
    }

    setUploading(false);
    if (successCount > 0) {
      toastSuccess(
        `${successCount} document${successCount === 1 ? "" : "s"} uploaded and indexed.`
      );
    }
  };

  const clearCompleted = () => setQueue((prev) => prev.filter((f) => f.status !== "done"));

  return (
    <Card className="p-6 mb-8">
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          dragOver ? "border-violet-500 bg-violet-50" : "border-line-strong hover:border-navy-700"
        }`}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-ink-400" aria-hidden="true">
          <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-sm font-medium text-ink-800">Drag PDFs here, or click to browse</p>
        <p className="text-xs text-ink-400">Upload one document, or select many for bulk onboarding.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {queue.length > 0 && (
        <div className="mt-5 flex flex-col gap-2">
          {queue.map((f) => (
            <div key={f.id} className="flex items-center gap-3 border border-line rounded-[var(--radius-control)] p-3">
              <div className="shrink-0">
                {f.status === "queued" && <Badge tone="neutral">Queued</Badge>}
                {f.status === "uploading" && <Spinner className="text-violet-500" />}
                {f.status === "done" && <Badge tone="teal">Uploaded</Badge>}
                {f.status === "failed" && <Badge tone="coral">Failed</Badge>}
              </div>
              <input
                value={f.title}
                onChange={(e) => updateTitle(f.id, e.target.value)}
                disabled={f.status !== "queued"}
                className="flex-1 min-w-0 h-9 text-sm border border-line-strong rounded-[var(--radius-control)] px-2.5 bg-surface disabled:opacity-60"
              />
              <span className="text-xs text-ink-400 shrink-0 hidden sm:inline">
                {(f.file.size / 1024 / 1024).toFixed(1)}MB
              </span>
              {f.status === "failed" && f.error && (
                <span className="text-xs text-seal-coral-700 max-w-[10rem] truncate" title={f.error}>
                  {f.error}
                </span>
              )}
              {f.status === "queued" && (
                <button
                  aria-label="Remove"
                  onClick={() => removeFromQueue(f.id)}
                  className="shrink-0 text-ink-400 hover:text-seal-coral-600"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mt-5">
        <Select label="Document type (applies to all)" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Input
          label="Department (optional)"
          placeholder="CSE, general..."
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        />
        <Input
          label="Academic year (optional)"
          placeholder="2026-27"
          value={academicYear}
          onChange={(e) => setAcademicYear(e.target.value)}
        />
        <Input
          type="date"
          label="Effective date (optional)"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
        {queue.length <= 1 && (
          <Select label="Supersedes (optional)" value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
            <option value="">None - this is a new document</option>
            {existingDocs
              .filter((d) => d.status !== "archived")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
          </Select>
        )}
      </div>

      <div className="flex items-center justify-between mt-6">
        <span className="text-xs text-ink-400">
          {queue.length > 0 ? `${queue.length} file${queue.length === 1 ? "" : "s"} queued` : ""}
        </span>
        <div className="flex gap-2">
          {queue.some((f) => f.status === "done") && (
            <Button variant="ghost" onClick={clearCompleted} disabled={uploading}>
              Clear completed
            </Button>
          )}
          <Button onClick={uploadAll} disabled={uploading || queue.length === 0}>
            {uploading
              ? "Uploading and indexing..."
              : queue.length > 1
              ? `Upload ${queue.length} documents`
              : "Upload and process"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
