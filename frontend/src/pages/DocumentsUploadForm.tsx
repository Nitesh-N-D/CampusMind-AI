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

// Mirrors the backend's supported extensions (app/ingestion/extractors.py).
const FILE_KINDS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  pptx: "PowerPoint",
  csv: "CSV",
  txt: "Text",
  jpg: "Image",
  jpeg: "Image",
  png: "Image",
};
const ACCEPT = Object.keys(FILE_KINDS)
  .map((ext) => `.${ext}`)
  .join(",");
const MAX_UPLOAD_MB = 25;

type FileStatus = "queued" | "uploading" | "done" | "failed";

interface QueuedFile {
  id: string;
  file: File;
  kind: string;
  title: string;
  status: FileStatus;
  error?: string;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function titleFromFilename(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const isPending = (f: QueuedFile) => f.status === "queued" || f.status === "failed";

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

  const pendingCount = queue.filter(isPending).length;

  const addFiles = (files: FileList | File[]) => {
    const rejected: string[] = [];
    const accepted = Array.from(files).filter((f) => {
      if (!(extensionOf(f.name) in FILE_KINDS)) {
        rejected.push(`${f.name} (unsupported type)`);
        return false;
      }
      if (f.size === 0) {
        rejected.push(`${f.name} (empty file)`);
        return false;
      }
      if (f.size > MAX_UPLOAD_MB * 1024 * 1024) {
        rejected.push(`${f.name} (over ${MAX_UPLOAD_MB}MB)`);
        return false;
      }
      return true;
    });
    setError(
      rejected.length
        ? `Skipped ${rejected.join(", ")}. Supported: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV, text (.txt), and images (.jpg, .png), up to ${MAX_UPLOAD_MB}MB each.`
        : null
    );
    if (accepted.length === 0) return;
    setQueue((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        kind: FILE_KINDS[extensionOf(file.name)],
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

  const markFailed = (id: string, message: string) =>
    setQueue((prev) => prev.map((f) => (f.id === id ? { ...f, status: "failed", error: message } : f)));

  const uploadAll = async () => {
    // Only files that haven't gone through yet - finished ones are never re-sent.
    const pending = queue.filter(isPending);
    if (pending.length === 0) {
      setError("Add at least one file to upload.");
      return;
    }
    if (pending.some((f) => !f.title.trim())) {
      setError("Every file needs a title before uploading.");
      return;
    }
    setError(null);
    setUploading(true);

    // Sequential, not parallel - this avoids hammering a free-tier AI/
    // embedding provider with a burst of concurrent requests, and keeps
    // per-file progress genuinely readable rather than a jumbled race.
    let successCount = 0;
    for (const item of pending) {
      setQueue((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: "uploading", error: undefined } : f))
      );
      try {
        const form = new FormData();
        form.append("file", item.file);
        form.append("title", item.title.trim());
        form.append("document_type", documentType);
        if (department) form.append("department", department);
        if (academicYear) form.append("academic_year", academicYear);
        if (effectiveDate) form.append("effective_date", effectiveDate);
        if (pending.length === 1 && supersedes) form.append("supersedes_id", supersedes);
        form.append("is_official", "true");
        const doc = await api.documents.upload(form);
        onUploaded(doc);
        // The upload itself can succeed while reading the file fails (damaged
        // file, no readable text) - from the admin's view that's a failure.
        if (doc.status === "failed") {
          markFailed(item.id, doc.processing_error || "This file couldn't be processed.");
        } else {
          setQueue((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "done" } : f)));
          successCount += 1;
        }
      } catch (err) {
        markFailed(item.id, err instanceof ApiError ? err.message : "Upload failed.");
      }
    }

    setUploading(false);
    if (successCount > 0) {
      toastSuccess(`${successCount} document${successCount === 1 ? "" : "s"} uploaded and indexed.`);
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
          dragOver ? "border-violet-500 bg-violet-50" : "border-line-strong hover:border-violet-500"
        }`}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-ink-400" aria-hidden="true">
          <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-sm font-medium text-ink-800">Drag files here, or click to browse</p>
        <p className="text-xs text-ink-400 max-w-md">
          PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV, text (.txt), or images (.jpg, .png), up to {MAX_UPLOAD_MB}MB each.
          Images and scanned PDFs are read with text recognition.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            // Allow picking the same file again after removing it.
            e.target.value = "";
          }}
        />
      </div>

      {queue.length > 0 && (
        <div className="mt-5 flex flex-col gap-2">
          {queue.map((f) => (
            <div key={f.id} className="border border-line rounded-[var(--radius-control)] p-3">
              <div className="flex items-center gap-3">
                <div className="shrink-0">
                  {f.status === "queued" && <Badge tone="neutral">Queued</Badge>}
                  {f.status === "uploading" && <Spinner className="text-violet-500" />}
                  {f.status === "done" && <Badge tone="teal">Indexed</Badge>}
                  {f.status === "failed" && <Badge tone="coral">Failed</Badge>}
                </div>
                <input
                  value={f.title}
                  onChange={(e) => updateTitle(f.id, e.target.value)}
                  disabled={!isPending(f) || uploading}
                  aria-label={`Title for ${f.file.name}`}
                  className="flex-1 min-w-0 h-9 text-sm text-ink-900 border border-line-strong rounded-[var(--radius-control)] px-2.5 bg-surface disabled:opacity-60"
                />
                <span className="shrink-0" title={`Detected type: ${f.kind}`}>
                  <Badge tone="violet">{f.kind}</Badge>
                </span>
                <span className="text-xs text-ink-400 shrink-0 hidden sm:inline">
                  {(f.file.size / 1024 / 1024).toFixed(1)}MB
                </span>
                {isPending(f) && !uploading && (
                  <button
                    aria-label={`Remove ${f.file.name}`}
                    onClick={() => removeFromQueue(f.id)}
                    className="shrink-0 text-ink-400 hover:text-seal-coral-600"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
              {f.status === "failed" && f.error && (
                <p className="mt-2 text-xs text-seal-coral-700 break-words">{f.error}</p>
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
        {pendingCount <= 1 && (
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

      <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
        <span className="text-xs text-ink-400">
          {pendingCount > 0 ? `${pendingCount} file${pendingCount === 1 ? "" : "s"} ready to upload` : ""}
        </span>
        <div className="flex gap-2">
          {queue.some((f) => f.status === "done") && (
            <Button variant="ghost" onClick={clearCompleted} disabled={uploading}>
              Clear completed
            </Button>
          )}
          <Button onClick={uploadAll} disabled={uploading || pendingCount === 0}>
            {uploading
              ? "Uploading and indexing..."
              : pendingCount > 1
              ? `Upload ${pendingCount} documents`
              : "Upload and process"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
