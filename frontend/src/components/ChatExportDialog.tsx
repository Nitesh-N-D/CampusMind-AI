import { useEffect, useRef, useState } from "react";
import { Button, ErrorBanner, Spinner } from "@/components/ui";
import { api, ApiError, type ChatSessionOut } from "@/lib/api";

type Format = "pdf" | "txt";

const FORMATS: { value: Format; label: string; hint: string }[] = [
  { value: "pdf", label: "PDF", hint: "Formatted, ready to print or share" },
  { value: "txt", label: "Plain text (.txt)", hint: "Opens anywhere, easy to copy from" },
];

/** Download the signed-in user's own conversations as PDF or plain text. */
export function ChatExportDialog({
  sessions,
  activeSession,
  onClose,
}: {
  sessions: ChatSessionOut[];
  activeSession: number | null;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<Format>("pdf");
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(activeSession !== null ? [activeSession] : sessions.slice(0, 1).map((s) => s.id))
  );
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !panelRef.current) return;
      // Keep Tab inside the dialog.
      const items = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = selected.size === sessions.length;

  const submit = async () => {
    setDownloading(true);
    setError(null);
    try {
      await api.chat.exportHistory([...selected], format);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't prepare the download. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink-950/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-export-title"
        className="relative w-full sm:max-w-md max-h-[90vh] flex flex-col bg-surface border-[1.5px] border-ink-950 rounded-t-[var(--radius-card)] sm:rounded-[var(--radius-card)] shadow-[var(--shadow-raised)]"
      >
        <div className="px-5 pt-5 pb-3">
          <h2 id="chat-export-title" className="text-2xl font-bold text-ink-950">
            Download chat history
          </h2>
          <span aria-hidden="true" className="block h-1.5 w-10 bg-lamp mt-2 rounded-[var(--radius-chip)]" />
          <p className="text-sm text-ink-700 mt-3">
            Includes your name, college, the time of every message, and the sources each answer cited.
          </p>
        </div>

        <fieldset className="px-5 pb-4 min-w-0">
          <legend className="label-caps mb-2">Format</legend>
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map((f) => (
              <label
                key={f.value}
                className={`cursor-pointer rounded-[var(--radius-control)] border-[1.5px] px-3 py-2.5 min-h-11 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-focus)] ${
                  format === f.value
                    ? "border-ink-950 bg-lamp text-on-lamp shadow-[3px_3px_0_var(--color-ink-950)]"
                    : "border-line-strong hover:bg-surface-hover"
                }`}
              >
                <input
                  type="radio"
                  name="export-format"
                  value={f.value}
                  checked={format === f.value}
                  onChange={() => setFormat(f.value)}
                  className="sr-only"
                />
                <span className={`block text-sm font-bold ${format === f.value ? "text-on-lamp" : "text-ink-950"}`}>
                  {f.label}
                </span>
                <span className={`block text-xs mt-0.5 ${format === f.value ? "text-on-lamp" : "text-ink-700"}`}>{f.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="px-5 pb-3 flex-1 min-h-0 min-w-0 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <legend className="label-caps">
              Conversations ({selected.size} of {sessions.length})
            </legend>
            <button
              type="button"
              onClick={() => setSelected(allSelected ? new Set() : new Set(sessions.map((s) => s.id)))}
              className="min-h-11 px-2 text-sm font-semibold text-violet-600 underline underline-offset-4 decoration-2"
            >
              {allSelected ? "Clear" : "Select all"}
            </button>
          </div>
          <ul className="overflow-y-auto border border-line rounded-[var(--radius-control)] divide-y divide-[var(--color-line)] max-h-64">
            {sessions.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-3 px-3 py-2.5 min-h-11 cursor-pointer hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="accent-[var(--color-navy-700)] w-4 h-4 shrink-0"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-ink-950 truncate">{s.title || "New conversation"}</span>
                    <span className="data block text-ink-500">
                      {new Date(s.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      {s.id === activeSession ? " · current" : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {error && (
          <div className="px-5 pb-3">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="px-5 py-4 border-t border-line flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={selected.size === 0 || downloading}>
            {downloading && <Spinner />}
            Download {format === "pdf" ? "PDF" : ".txt"}
          </Button>
        </div>
      </div>
    </div>
  );
}
