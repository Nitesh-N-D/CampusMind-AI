import { useToastStore, type Toast } from "@/lib/toastStore";

/**
 * Toasts speak the product's status vocabulary: a shape mark plus a spoken
 * label, never colour alone. Success is a lamp diamond, warning and error are
 * triangles (error is heavier), info is a plain ring.
 */
const TONES: Record<Toast["tone"], { label: string; mark: string; bar: string; markCls: string }> = {
  success: { label: "Done", mark: "◆", bar: "border-l-lamp", markCls: "bg-lamp text-on-lamp" },
  info: { label: "Note", mark: "○", bar: "border-l-ink-500", markCls: "bg-paper-200 text-ink-900" },
  warning: { label: "Check", mark: "▲", bar: "border-l-seal-amber-600", markCls: "bg-seal-amber-100 text-seal-amber-900" },
  error: { label: "Problem", mark: "▲", bar: "border-l-seal-coral-600", markCls: "bg-seal-coral-100 text-seal-coral-900" },
};

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 sm:top-auto sm:bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-full">
      {toasts.map((t) => {
        const tone = TONES[t.tone] ?? TONES.info;
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`animate-rise flex items-start gap-3 bg-surface text-ink-900 border-[1.5px] border-ink-950 border-l-[6px] ${tone.bar} rounded-[var(--radius-control)] pl-3 pr-1 py-2 text-sm shadow-[var(--shadow-raised)]`}
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-chip)] text-[10px] ${tone.markCls}`}
            >
              {tone.mark}
            </span>
            <p className="flex-1 min-w-0 py-0.5 break-words">
              <span className="sr-only">{tone.label}: </span>
              {t.message}
            </p>
            <button
              type="button"
              aria-label={`Dismiss: ${t.message}`}
              onClick={() => dismiss(t.id)}
              className="shrink-0 w-11 h-11 -my-1 inline-flex items-center justify-center text-ink-700 hover:text-ink-950"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
